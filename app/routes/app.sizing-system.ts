import { type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { requestT } from "../lib/i18n";
import { loadShopSettings } from "../lib/shop-settings.server";
import { planCaps } from "../lib/plans";
import {
  extractProductChart,
  getAIConfig,
  EXTRACTION_VERSION,
  parseStructuredRows,
  structuredRowsAsPromptText,
} from "../lib/size-advisor.server";

const MAX_IMAGE_CHARS = 3_600_000;
const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,/;

type SystemRow = {
  id: string;
  name: string;
  parsedSizeData: string | null;
  customNotes: string | null;
  structuredSizeData: string | null;
  sizeChartImage: string | null;
};

// Analiza AI systemu rozmiarów. Bez opisu produktu (system nie jest przypięty
// do jednego produktu) — czytamy z notatek, zweryfikowanej siatki (jako
// kontekst liczbowy dla oceny kroju) i opcjonalnego zdjęcia rozmiarówki.
// Wynik trafia WYŁĄCZNIE do "Co zrozumiała AI" / przycisku "Wypełnij z
// ostatniej analizy AI" — nigdy nie wpisuje się do tabeli automatycznie
// (systemy są współdzielone przez wiele produktów, więc błąd AI w odczycie
// ma tu większy zasięg niż przy jednym produkcie).
async function runSystemExtraction(
  system: SystemRow,
  opts: { brandStyleNotes: string | null; language: string | null; sizeChartImageAI: boolean },
): Promise<boolean> {
  const { provider, model } = getAIConfig();
  const apiKey =
    provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY;
  const useImage = opts.sizeChartImageAI && Boolean(system.sizeChartImage);
  if (!apiKey) return false;

  const structuredRows = parseStructuredRows(system.structuredSizeData);
  // Bez zdjęcia, notatek i zweryfikowanej siatki AI dostałoby do analizy
  // tylko samą nazwę systemu — prompt każe wtedy zwrócić "tabela": [], ale
  // model czasem próbuje "coś" wymyślić zamiast pustej odpowiedzi (patrz
  // 2d9ebda i komentarz w app.product-rule.ts). Skoro nie ma z czego czytać,
  // w ogóle nie pytamy modelu.
  const hasAnyInput =
    useImage || Boolean(system.customNotes?.trim()) || Boolean(structuredRows);
  if (!hasAnyInput) {
    await db.sizingSystem.update({
      where: { id: system.id },
      data: {
        extractionJson: null,
        extractionAt: null,
        extractionModel: null,
        extractionVersion: null,
        extractionError: null,
      },
    });
    return false;
  }

  try {
    const { rawJson } = await extractProductChart(model, {
      productTitle: system.name || null,
      productDescription: null,
      brandStyleNotes: opts.brandStyleNotes,
      // Patrz analogiczny komentarz w app.product-rule.ts: `parsedSizeData`
      // nie ma już swojego pola w edytorze, więc go nie wysyłamy. Zamiast
      // tego, gdy jest zweryfikowana siatka, podajemy JĄ jako tabelę — inaczej
      // (bez zdjęcia) AI nie miałoby żadnych liczb do oceny "krojLuz" i
      // zgadywałoby wyłącznie z nazwy systemu.
      productSizeData: structuredRows ? structuredRowsAsPromptText(structuredRows) : null,
      productNotes: system.customNotes || null,
      sizeChartImage: useImage ? system.sizeChartImage : null,
      hasSizeChartImage: useImage,
      responseLanguage: opts.language === "en" ? "en" : "pl",
    });
    await db.sizingSystem.update({
      where: { id: system.id },
      data: {
        extractionJson: JSON.stringify(rawJson),
        extractionAt: new Date(),
        extractionModel: model,
        extractionVersion: EXTRACTION_VERSION,
        extractionError: null,
      },
    });
    return true;
  } catch (e) {
    console.error("[sizing-system] analiza nie powiodła się", e);
    await db.sizingSystem.update({
      where: { id: system.id },
      data: {
        extractionJson: null,
        extractionError: e instanceof Error ? e.message : "unknown",
        extractionVersion: null,
      },
    });
    return false;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const t = requestT(request);
  const settings = await loadShopSettings(session.shop);
  const caps = planCaps(settings.plan);

  const form = (await request.json()) as {
    intent?: string;
    id?: string;
    name?: string;
    customNotes?: string;
    parsedSizeData?: string;
    structuredSizeData?: string | null;
    sizeChartImage?: string | null;
  };

  const extractOpts = {
    brandStyleNotes: settings.aiStyleNotes ?? null,
    language: settings.language ?? null,
    sizeChartImageAI: caps.sizeChartImageAI,
  };

  if (form.intent === "delete") {
    if (!form.id) return Response.json({ error: t("error.status", { status: 400 }) }, { status: 400 });
    // Zerwij przypisania i usuń system.
    await db.productRule.updateMany({
      where: { shopId: settings.id, sizingSystemId: form.id },
      data: { sizingSystemId: null },
    });
    await db.sizingSystem.deleteMany({ where: { id: form.id, shopId: settings.id } });
    return Response.json({ success: true, deleted: true });
  }

  if (form.intent === "reanalyze") {
    const existing = form.id
      ? await db.sizingSystem.findFirst({
          where: { id: form.id, shopId: settings.id },
        })
      : null;
    if (!existing) {
      return Response.json({ error: t("error.status", { status: 404 }) }, { status: 404 });
    }
    const analyzed = await runSystemExtraction(existing, extractOpts);
    return Response.json({ success: true, analyzed });
  }

  const name = String(form.name || "").trim().slice(0, 80);
  if (!name) {
    return Response.json({ error: t("sizingSystems.error.name") }, { status: 400 });
  }
  // Siatka wymiarów przychodzi już jako JSON z panelu (SizeGrid.gridToPayload);
  // re-parsujemy przez parseStructuredRows, żeby nie zaufać ślepo klientowi.
  const structuredRows = parseStructuredRows(form.structuredSizeData ?? null);

  let sizeChartImage: string | null = form.sizeChartImage ?? null;
  if (sizeChartImage && !IMAGE_DATA_URL.test(sizeChartImage)) {
    sizeChartImage = null;
  }
  if (sizeChartImage && !caps.sizeChartImageAI) {
    return Response.json({ error: t("gate.image_locked") }, { status: 403 });
  }
  if (sizeChartImage && sizeChartImage.length > MAX_IMAGE_CHARS) {
    return Response.json({ error: t("error.imageTooLarge") }, { status: 400 });
  }

  const payload = {
    name,
    customNotes: String(form.customNotes || "").slice(0, 1500),
    parsedSizeData: String(form.parsedSizeData || "").slice(0, 3000),
    structuredSizeData: structuredRows ? JSON.stringify(structuredRows) : null,
    sizeChartImage,
  };

  // Kolizja nazwy z innym systemem tego sklepu.
  const clash = await db.sizingSystem.findFirst({
    where: {
      shopId: settings.id,
      name,
      ...(form.id ? { NOT: { id: form.id } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    return Response.json({ error: t("sizingSystems.error.dupe") }, { status: 409 });
  }

  const system = form.id
    ? await db.sizingSystem.update({
        where: { id: form.id },
        data: payload,
      })
    : await db.sizingSystem.create({
        data: { shopId: settings.id, ...payload },
      });

  const analyzed = await runSystemExtraction(system, extractOpts);
  return Response.json({ success: true, id: system.id, analyzed });
};
