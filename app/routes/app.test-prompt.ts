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
    refBrand?: string;
    refSize?: string;
    productId?: string;
  };

  const height = Number(body.height);
  const weight = Number(body.weight);
  const fit: "fitted" | "loose" | null =
    body.fitPreference === "fitted" || body.fitPreference === "loose"
      ? body.fitPreference
      : null;
  const refBrandS = String(body.refBrand ?? "").trim().slice(0, 40);
  const refSizeS = String(body.refSize ?? "").trim().slice(0, 16);
  const referenceGarment =
    refBrandS && refSizeS ? { brand: refBrandS, size: refSizeS } : null;
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
  } | null = null;

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
  }

  const adminLocale =
    normalizeLocale(new URL(request.url).searchParams.get("locale")) ?? "pl";

  const useImage = caps.sizeChartImageAI && Boolean(productRule?.sizeChartImage);

  const prompt = buildSizeAdvisorPrompt({
    productTitle,
    productDescription,
    gender: body.gender,
    height,
    weight,
    bodyType: body.bodyType,
    brandStyleNotes: settings?.aiStyleNotes ?? null,
    productSizeData: productRule?.parsedSizeData,
    productNotes: productRule?.customNotes,
    hasSizeChartImage: useImage,
    fitPreference: fit,
    referenceGarment,
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
          settings?.aiStyleNotes?.trim() || productRule?.customNotes?.trim(),
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
      fitOffset: result.fitOffset,
      usedBrandStyle: Boolean(settings?.aiStyleNotes?.trim()),
      productTitle,
      usedProductChart: Boolean(productRule?.parsedSizeData?.trim() || useImage),
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
