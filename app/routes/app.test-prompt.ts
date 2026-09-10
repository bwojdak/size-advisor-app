import { type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  buildSizeAdvisorPrompt,
  callAI,
  getAIConfig,
  AIQuotaError,
} from "../lib/size-advisor.server";
import { normalizeLocale, requestT } from "../lib/i18n";
import { loadShopSettings } from "../lib/shop-settings.server";
import { planCaps } from "../lib/plans";

// Test promptu uruchamiany przez właściciela sklepu w panelu.
// Świadomie NIE dotyka `requestsUsed` ani `AdvisorLog` — to nie jest zapytanie
// klienta, więc nie zjada miesięcznej puli i nie trafia do historii.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const t = requestT(request);

  const settings = await loadShopSettings(shop);
  const caps = planCaps(settings.plan);
  if (!caps.promptTester) {
    return Response.json({ error: t("gate.tester_locked") }, { status: 403 });
  }

  const { provider, model } = getAIConfig();
  const apiKey =
    provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: t("error.noApiKey") }, { status: 500 });
  }

  const body = (await request.json()) as {
    height?: number | string;
    weight?: number | string;
    gender?: string;
    bodyType?: string;
    fitPreference?: string;
    refMeasurements?: Record<string, unknown>;
    productId?: string;
  };

  const height = Number(body.height);
  const weight = Number(body.weight);
  const fit: "fitted" | "loose" | null =
    body.fitPreference === "fitted" || body.fitPreference === "loose"
      ? body.fitPreference
      : null;
  // Ubranie referencyjne w testerze: pola wymiarów (na płasko, cm).
  const referenceGarment = (() => {
    const src =
      body.refMeasurements && typeof body.refMeasurements === "object"
        ? (body.refMeasurements as Record<string, unknown>)
        : {};
    const m: {
      chest?: number;
      waist?: number;
      hip?: number;
      length?: number;
      inseam?: number;
    } = {};
    for (const k of ["chest", "waist", "hip", "length", "inseam"] as const) {
      const n = Number(src[k]);
      if (Number.isFinite(n) && n >= 15 && n <= 150) m[k] = Math.round(n);
    }
    return Object.keys(m).length ? { measurements: m } : null;
  })();
  if (!height || !weight) {
    return Response.json({ error: t("error.missingHeightWeight") }, { status: 400 });
  }

  // Opcjonalny kontekst produktu — bez niego test dotyczy „generycznej odzieży".
  const numericProductId = String(body.productId ?? "").replace(/\D/g, "");
  let productTitle: string | null = null;
  let productDescription: string | null = null;
  let productRule: {
    parsedSizeData: string | null;
    customNotes: string | null;
    sizeChartImage: string | null;
    sizingSystemId: string | null;
  } | null = null;
  // Produkt zmapowany na współdzielony system → silnik (i tester) czyta tabelę
  // z SYSTEMU, nie z własnej (uśpionej) tabeli produktu.
  let sizingSystem: { name: string; parsedSizeData: string | null; customNotes: string | null } | null = null;

  if (numericProductId) {
    const [gqlResp, rule] = await Promise.all([
      admin.graphql(
        `#graphql
        query SizeAdvisorTestProduct($id: ID!) {
          product(id: $id) { title description }
        }`,
        { variables: { id: `gid://shopify/Product/${numericProductId}` } },
      ),
      db.productRule.findUnique({
        where: { shopId_productId: { shopId: settings.id, productId: numericProductId } },
      }),
    ]);
    const gql = await gqlResp.json();
    productTitle = gql?.data?.product?.title ?? null;
    productDescription = gql?.data?.product?.description ?? null;
    productRule = rule;

    if (rule?.sizingSystemId) {
      sizingSystem = await db.sizingSystem.findUnique({
        where: { id: rule.sizingSystemId },
        select: { name: true, parsedSizeData: true, customNotes: true },
      });
    }
  }

  // Źródło tabeli i notatek: system (jeśli przypięty) albo własna tabela produktu.
  const chartSizeData = sizingSystem
    ? sizingSystem.parsedSizeData
    : productRule?.parsedSizeData;
  const chartNotes = sizingSystem
    ? sizingSystem.customNotes
    : productRule?.customNotes;

  const adminLocale =
    normalizeLocale(new URL(request.url).searchParams.get("locale")) ?? "pl";

  // Zdjęcie rozmiarówki tylko dla produktu z własną tabelą (system jest tekstowy).
  const useImage =
    caps.sizeChartImageAI && !sizingSystem && Boolean(productRule?.sizeChartImage);

  const prompt = buildSizeAdvisorPrompt({
    productTitle: sizingSystem ? "" : productTitle,
    productDescription: sizingSystem ? "" : productDescription,
    gender: body.gender,
    height,
    weight,
    bodyType: body.bodyType,
    brandStyleNotes: settings?.aiStyleNotes ?? null,
    productSizeData: chartSizeData,
    productNotes: chartNotes,
    hasSizeChartImage: useImage,
    fitPreference: fit,
    responseLanguage: adminLocale,
  });

  try {
    const result = await callAI({
      model,
      prompt,
      sizeChartImage: useImage ? productRule?.sizeChartImage : null,
      decision: {
        height,
        weight,
        gender: body.gender,
        bodyType: body.bodyType,
        fit,
        locale: adminLocale,
        allowKorekta: Boolean(
          settings?.aiStyleNotes?.trim() || chartNotes?.trim(),
        ),
        referenceGarment,
      },
    });
    return Response.json({
      size: result.size,
      explanation: result.explanation,
      explanationDetail: result.explanationDetail,
      neighborSmaller: result.neighborSmaller,
      neighborLarger: result.neighborLarger,
      fitScale: result.fitScale,
      usedBrandStyle: Boolean(settings?.aiStyleNotes?.trim()),
      productTitle,
      sizingSystemName: sizingSystem?.name ?? null,
      usedProductChart: Boolean(chartSizeData?.trim() || useImage),
      promptTokenCount: result.promptTokenCount,
    });
  } catch (err) {
    if (err instanceof AIQuotaError) {
      return Response.json({ error: t("error.quotaExhausted") }, { status: 503 });
    }
    console.error("Test prompt error:", err);
    return Response.json({ error: t("error.testFailed") }, { status: 502 });
  }
};
