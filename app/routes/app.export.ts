import { type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadShopSettings } from "../lib/shop-settings.server";
import { planCaps } from "../lib/plans";
import { requestT } from "../lib/i18n";

const HEADERS = [
  "created_at",
  "product",
  "height_cm",
  "weight_kg",
  "gender",
  "body_type",
  "recommended_size",
  "added_to_cart",
  "purchased",
  "order_id",
];

function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  // Ochrona przed CSV/formula injection — arkusze traktują komórkę zaczynającą
  // się od = + - @ (lub tab/CR) jako formułę. `productTitle` może pochodzić ze
  // spreparowanego żądania do /recommend.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Eksport CSV — tylko plan z `csvExport`.
//   (domyślnie)          → surowa historia zapytań kupujących (jeden wiersz = rekomendacja)
//   ?report=products     → zestawienie per produkt (rekomendacje / do koszyka / zakupy + %)
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await loadShopSettings(session.shop);
  const caps = planCaps(settings.plan);

  if (!caps.csvExport) {
    return new Response(requestT(request)("gate.csv_locked"), { status: 403 });
  }

  const date = new Date().toISOString().slice(0, 10);

  if (new URL(request.url).searchParams.get("report") === "products") {
    // Uwaga: żaden plan z csvExport dziś nie ma historyDays===0 (Free, jedyny
    // taki plan, ma csvExport=false i jest odcięty bramką wyżej) — ale gdyby
    // to się zmieniło, `|| 400` cichcem wracałoby do dokładnie tego samego
    // buga, który naprawiliśmy w Analityce (0 dni = więcej historii niż
    // płatny plan). Bez fallbacku, zgodnie z kontraktem PlanCapabilities.
    const windowDays = caps.historyDays;
    const since = new Date();
    since.setDate(since.getDate() - windowDays);

    const logs = await db.advisorLog.findMany({
      where: { shopId: settings.id, createdAt: { gte: since } },
      select: { productTitle: true, addedToCart: true, purchased: true },
      take: 50000,
    });

    const agg = new Map<string, { n: number; a: number; p: number }>();
    for (const l of logs) {
      const key = l.productTitle || "—";
      const e = agg.get(key) ?? { n: 0, a: 0, p: 0 };
      e.n += 1;
      if (l.addedToCart) e.a += 1;
      if (l.purchased) e.p += 1;
      agg.set(key, e);
    }
    const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
    const list = [...agg.entries()].sort((x, y) => y[1].n - x[1].n);
    const totals = list.reduce(
      (s, [, e]) => ({ n: s.n + e.n, a: s.a + e.a, p: s.p + e.p }),
      { n: 0, a: 0, p: 0 },
    );

    const header = [
      "product",
      "recommendations",
      "added_to_cart",
      "purchased",
      "add_to_cart_rate_pct",
      "purchase_rate_pct",
    ];
    const bodyRows = [
      ...list.map(([title, e]) =>
        [title, e.n, e.a, e.p, pctOf(e.a, e.n), pctOf(e.p, e.n)]
          .map(csvCell)
          .join(","),
      ),
      ["TOTAL", totals.n, totals.a, totals.p, pctOf(totals.a, totals.n), pctOf(totals.p, totals.n)]
        .map(csvCell)
        .join(","),
    ];

    return new Response("﻿" + [header.join(","), ...bodyRows].join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="size-advisor-analytics-${date}.csv"`,
      },
    });
  }

  const logs = await db.advisorLog.findMany({
    where: { shopId: settings.id },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });

  const rows = logs.map((l) =>
    [
      l.createdAt.toISOString(),
      l.productTitle,
      l.customerHeight,
      l.customerWeight,
      l.customerGender,
      l.bodyType,
      l.recommendedSize,
      l.addedToCart ? "yes" : "no",
      l.purchased ? "yes" : "no",
      l.orderId ?? "",
    ]
      .map(csvCell)
      .join(","),
  );

  const csv = [HEADERS.join(","), ...rows].join("\n");

  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="size-advisor-${date}.csv"`,
    },
  });
};
