import { type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadShopSettings } from "../lib/shop-settings.server";
import { planCaps } from "../lib/plans";
import { requestT } from "../lib/i18n";

// Masowy import rozmiarówek z CSV (plan Pro). Wołane fetch-em z app.products.tsx.
// Oczekiwane kolumny (nagłówek, dowolna kolejność, PL/EN aliasy):
//   product_id | id       — numeryczne ID produktu Shopify (wymagane)
//   size | rozmiar        — etykieta rozmiaru (wymagane)
//   chest|klatka, waist|pas, hip|biodra, length|dlugosc, inseam|nogawka — opcjonalne wymiary
// Wiersze tego samego produktu składane są w jedną tabelę tekstową ProductRule.parsedSizeData.

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === "," || c === ";" || c === "\t") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_"'-]/g, "");

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const t = requestT(request);
  const settings = await loadShopSettings(session.shop);

  if (!planCaps(settings.plan).bulkImport) {
    return Response.json(
      { error: t("gate.locked_from", { plan: "Pro" }) },
      { status: 403 },
    );
  }

  const { csv } = (await request.json()) as { csv?: string };
  if (typeof csv !== "string" || !csv.trim()) {
    return Response.json({ error: t("import.empty") }, { status: 400 });
  }

  const rows = parseCsv(csv);
  const header = (rows.shift() ?? []).map(norm);
  const findCol = (aliases: string[]) =>
    header.findIndex((h) => aliases.some((a) => h === norm(a)));

  const idIdx = findCol(["product_id", "productid", "id", "gid"]);
  const sizeIdx = findCol(["size", "rozmiar"]);
  if (idIdx < 0 || sizeIdx < 0) {
    return Response.json({ error: t("import.badHeader") }, { status: 400 });
  }

  const dims: Array<[string, number]> = [
    ["klatka", findCol(["chest", "klatka", "obwodklatki", "bust"])],
    ["pas", findCol(["waist", "pas", "obwodpasa"])],
    ["biodra", findCol(["hip", "hips", "biodra", "obwodbioder"])],
    ["długość", findCol(["length", "dlugosc", "długość", "back"])],
    ["nogawka", findCol(["inseam", "nogawka", "dlugoscnogawki"])],
  ];

  const byProduct = new Map<string, string[]>();
  for (const r of rows) {
    const pid = String(r[idIdx] ?? "").replace(/\D/g, "");
    const size = String(r[sizeIdx] ?? "").trim();
    if (!pid || !size) continue;
    const parts: string[] = [];
    for (const [label, i] of dims) {
      const v = i >= 0 ? String(r[i] ?? "").trim() : "";
      if (v) parts.push(`${label} ${v}`);
    }
    if (!parts.length) continue;
    const line = `Rozmiar ${size}: ${parts.join(", ")}`;
    if (!byProduct.has(pid)) byProduct.set(pid, []);
    byProduct.get(pid)!.push(line);
  }

  if (byProduct.size === 0) {
    return Response.json({ error: t("import.noRows") }, { status: 400 });
  }

  let count = 0;
  for (const [pid, lines] of byProduct) {
    const parsedSizeData = lines.join("\n").slice(0, 5000);
    // Zerujemy analizę — przy imporcie masowym nie wołamy modelu N razy pod
    // rząd; ekstrakcja dorobi się leniwie przy pierwszym zapytaniu o produkt.
    await db.productRule.upsert({
      where: { shopId_productId: { shopId: settings.id, productId: pid } },
      create: { shopId: settings.id, productId: pid, parsedSizeData },
      update: {
        parsedSizeData,
        extractionJson: null,
        extractionVersion: null,
        extractionError: null,
      },
    });
    count += 1;
  }

  return Response.json({ success: true, count });
};
