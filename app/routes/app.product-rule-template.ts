import { type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadShopSettings } from "../lib/shop-settings.server";
import { PLAN, planCaps } from "../lib/plans";
import { requestT } from "../lib/i18n";

// Szablon CSV do masowego importu rozmiarówek (Starter+). Zwraca WSZYSTKIE
// produkty sklepu z wpisanym `product_id` + tytułem, żeby merchant nie musiał
// ręcznie zdobywać numerycznych ID — dopisuje tylko wymiary i wgrywa z powrotem.
// Kolumna `configured` (yes/pusto) mówi, które produkty mają już rozmiarówkę.
// Import pomija wiersze bez `size`/wymiarów, więc puste wiersze są nieszkodliwe.
const HEADER = [
  "product_id",
  "title",
  "configured",
  "size",
  "chest",
  "waist",
  "hip",
  "length",
  "inseam",
];

const MAX_PRODUCTS = 2000;
const PAGE = 250;

function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  // Ochrona przed CSV/formula injection (tytuły produktów).
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const t = requestT(request);
  const settings = await loadShopSettings(session.shop);

  if (!planCaps(settings.plan).bulkImport) {
    return new Response(t("gate.locked_from", { plan: PLAN.STARTER }), { status: 403 });
  }

  // Produkty, które MAJĄ już wpisaną tabelę wymiarów — oznaczamy w kolumnie
  // `configured`, nie wykluczamy (merchant widzi cały katalog + status).
  const configured = new Set<string>();
  const existing = await db.productRule.findMany({
    where: { shopId: settings.id },
    select: { productId: true, parsedSizeData: true },
  });
  for (const r of existing) {
    if ((r.parsedSizeData ?? "").trim()) configured.add(r.productId);
  }

  const rows: Array<[string, string, string]> = [];
  let cursor: string | null = null;

  while (rows.length < MAX_PRODUCTS) {
    const resp = await admin.graphql(
      `#graphql
      query SizeAdvisorTemplateProducts($first: Int!, $after: String) {
        products(first: $first, after: $after, sortKey: TITLE) {
          nodes { id title }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { variables: { first: PAGE, after: cursor } },
    );
    const body = (await resp.json()) as {
      data?: {
        products?: {
          nodes?: Array<{ id?: string; title?: string }>;
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        };
      };
    };
    const page = body?.data?.products;
    for (const n of page?.nodes ?? []) {
      const id = String(n?.id ?? "").split("/").pop() ?? "";
      if (id) rows.push([id, n?.title ?? "", configured.has(id) ? "yes" : ""]);
    }
    if (!page?.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break;
    cursor = page.pageInfo.endCursor;
  }

  // Bez BOM — nagłówek musi zaczynać się dokładnie od "product_id", inaczej
  // parser importu (norm → alias "product_id") go nie rozpozna.
  const body = [
    HEADER.join(","),
    ...rows.map(([id, title, cfg]) =>
      [id, title, cfg, "", "", "", "", "", ""].map(csvCell).join(","),
    ),
  ].join("\r\n");

  const date = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="size-advisor-import-template-${date}.csv"`,
    },
  });
};
