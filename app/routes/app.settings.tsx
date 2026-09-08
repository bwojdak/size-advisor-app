import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useRevalidator } from "react-router";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Collapsible,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { loadShopSettings } from "../lib/shop-settings.server";
import { planCaps } from "../lib/plans";
import { useI18n, type Locale } from "../lib/i18n";
import { LockedFeature } from "../components/LockedFeature";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await loadShopSettings(session.shop);

  const caps = planCaps(settings.plan);
  return {
    aiStyleNotes: settings.aiStyleNotes ?? "",
    language: settings.language ?? "auto",
    promptTester: caps.promptTester,
    fitPreferenceAvailable: caps.fitPreference,
    askFitPreference: settings.askFitPreference,
    garmentMatchAvailable: caps.garmentMatch,
    askGarmentMatch: settings.askGarmentMatch,
    shopperLangSwitch: caps.multilingual,
    widgetLanguage: settings.widgetLanguage ?? "auto",
    customCssAvailable: caps.customCss,
    widgetCustomCss: settings.widgetCustomCss ?? "",
    analyticsAvailable: caps.conversionAnalytics,
    baselineReturnRate:
      typeof settings.baselineReturnRate === "number"
        ? Math.round(settings.baselineReturnRate * 100)
        : "",
  };
};

function toast(message: string, isError = false) {
  const api = (
    window as unknown as {
      shopify?: { toast?: { show: (m: string, o?: { isError?: boolean }) => void } };
    }
  ).shopify;
  api?.toast?.show(message, { isError });
}

async function authFetch(url: string, payload: unknown, locale: Locale) {
  const api = (window as unknown as { shopify?: { idToken: () => Promise<string> } }).shopify;
  const token = api ? await api.idToken() : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const sep = url.includes("?") ? "&" : "?";
  const res = await fetch(`${url}${sep}locale=${locale}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || "");
  return json;
}

export default function SettingsPage() {
  const {
    aiStyleNotes,
    language,
    promptTester,
    fitPreferenceAvailable,
    askFitPreference,
    garmentMatchAvailable,
    askGarmentMatch,
    shopperLangSwitch,
    widgetLanguage,
    customCssAvailable,
    widgetCustomCss,
    analyticsAvailable,
    baselineReturnRate,
  } = useLoaderData<typeof loader>();
  const { t, locale } = useI18n();
  const revalidator = useRevalidator();

  const [fitPref, setFitPref] = useState(askFitPreference);
  const [savingFitPref, setSavingFitPref] = useState(false);
  const [fitPrefError, setFitPrefError] = useState<string | null>(null);

  const [garment, setGarment] = useState(askGarmentMatch);
  const [savingGarment, setSavingGarment] = useState(false);
  const [garmentError, setGarmentError] = useState<string | null>(null);

  const toggleGarment = async (checked: boolean) => {
    setGarment(checked);
    setSavingGarment(true);
    setGarmentError(null);
    try {
      await authFetch("/app/widget-settings", { askGarmentMatch: checked }, locale);
      toast(t("settings.brand.saved"));
    } catch (err) {
      setGarment(!checked);
      setGarmentError(
        err instanceof Error && err.message
          ? err.message
          : t("settings.error.saveFailed"),
      );
    } finally {
      setSavingGarment(false);
    }
  };

  const [widgetLang, setWidgetLang] = useState(widgetLanguage);
  const [savingWidgetLang, setSavingWidgetLang] = useState(false);
  const [widgetLangError, setWidgetLangError] = useState<string | null>(null);

  const changeWidgetLang = async (value: string) => {
    const prev = widgetLang;
    setWidgetLang(value);
    setSavingWidgetLang(true);
    setWidgetLangError(null);
    try {
      await authFetch("/app/widget-settings", { widgetLanguage: value }, locale);
      toast(t("settings.brand.saved"));
    } catch (err) {
      setWidgetLang(prev);
      setWidgetLangError(
        err instanceof Error && err.message
          ? err.message
          : t("settings.error.saveFailed"),
      );
    } finally {
      setSavingWidgetLang(false);
    }
  };

  const [css, setCss] = useState(widgetCustomCss);
  const [savedCss, setSavedCss] = useState(widgetCustomCss);
  const [savingCss, setSavingCss] = useState(false);
  const [cssError, setCssError] = useState<string | null>(null);
  const [cssRefOpen, setCssRefOpen] = useState(false);

  const saveCss = async () => {
    setSavingCss(true);
    setCssError(null);
    try {
      const json = await authFetch(
        "/app/widget-settings",
        { widgetCustomCss: css },
        locale,
      );
      setSavedCss(json.widgetCustomCss ?? css);
      setCss(json.widgetCustomCss ?? css);
      toast(t("settings.brand.saved"));
    } catch (err) {
      setCssError(
        err instanceof Error && err.message
          ? err.message
          : t("settings.error.saveFailed"),
      );
    } finally {
      setSavingCss(false);
    }
  };

  const [returnRate, setReturnRate] = useState(
    baselineReturnRate === "" ? "" : String(baselineReturnRate),
  );
  const [savedReturnRate, setSavedReturnRate] = useState(
    baselineReturnRate === "" ? "" : String(baselineReturnRate),
  );
  const [savingReturnRate, setSavingReturnRate] = useState(false);
  const [returnRateError, setReturnRateError] = useState<string | null>(null);

  const saveReturnRate = async () => {
    setSavingReturnRate(true);
    setReturnRateError(null);
    try {
      const json = await authFetch(
        "/app/widget-settings",
        { baselineReturnRate: returnRate === "" ? null : returnRate },
        locale,
      );
      const next =
        typeof json.baselineReturnRate === "number"
          ? String(Math.round(json.baselineReturnRate * 100))
          : "";
      setReturnRate(next);
      setSavedReturnRate(next);
      toast(t("settings.brand.saved"));
    } catch (err) {
      setReturnRateError(
        err instanceof Error && err.message
          ? err.message
          : t("settings.error.saveFailed"),
      );
    } finally {
      setSavingReturnRate(false);
    }
  };

  const toggleFitPref = async (checked: boolean) => {
    setFitPref(checked);
    setSavingFitPref(true);
    setFitPrefError(null);
    try {
      await authFetch("/app/widget-settings", { askFitPreference: checked }, locale);
      toast(t("settings.brand.saved"));
    } catch (err) {
      setFitPref(!checked); // rollback
      setFitPrefError(
        err instanceof Error && err.message ? err.message : t("settings.error.saveFailed"),
      );
    } finally {
      setSavingFitPref(false);
    }
  };

  const [styleNotes, setStyleNotes] = useState(aiStyleNotes);
  const [savedNotes, setSavedNotes] = useState(aiStyleNotes);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  const [lang, setLang] = useState(language);
  const [savingLang, setSavingLang] = useState(false);
  const [langError, setLangError] = useState<string | null>(null);

  const [testHeight, setTestHeight] = useState("182");
  const [testWeight, setTestWeight] = useState("78");
  const [testGender, setTestGender] = useState("male");
  const [testBody, setTestBody] = useState("standard");
  const [testFit, setTestFit] = useState("");
  const [testRefBrand, setTestRefBrand] = useState("");
  const [testRefSize, setTestRefSize] = useState("");
  const [testProduct, setTestProduct] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    size: string;
    explanation: string;
    usedBrandStyle: boolean;
    productTitle: string | null;
    usedProductChart: boolean;
  } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const pickTestProduct = async () => {
    const api = (window as unknown as {
      shopify?: {
        resourcePicker: (opts: {
          type: string;
          action?: string;
          multiple?: boolean;
        }) => Promise<Array<{ id: string; title: string }> | undefined>;
      };
    }).shopify;
    if (!api?.resourcePicker) return;
    const sel = await api.resourcePicker({
      type: "product",
      action: "select",
      multiple: false,
    });
    const p = sel?.[0];
    if (p) setTestProduct({ id: String(p.id).split("/").pop() as string, title: p.title });
  };

  const saveNotes = async () => {
    setSavingNotes(true);
    setNotesError(null);
    try {
      const json = await authFetch("/app/style-notes", { aiStyleNotes: styleNotes }, locale);
      setSavedNotes(json.aiStyleNotes ?? styleNotes);
      toast(t("settings.brand.saved"));
    } catch (err) {
      setNotesError(
        err instanceof Error && err.message ? err.message : t("settings.error.saveFailed"),
      );
    } finally {
      setSavingNotes(false);
    }
  };

  const saveLang = async () => {
    setSavingLang(true);
    setLangError(null);
    try {
      await authFetch("/app/locale", { language: lang }, locale);
      toast(t("settings.brand.saved"));
      revalidator.revalidate();
    } catch (err) {
      setLangError(
        err instanceof Error && err.message ? err.message : t("settings.error.saveFailed"),
      );
    } finally {
      setSavingLang(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const json = await authFetch(
        "/app/test-prompt",
        {
          height: testHeight,
          weight: testWeight,
          gender: testGender,
          bodyType: testBody,
          fitPreference: testFit,
          refBrand: testRefBrand,
          refSize: testRefSize,
          productId: testProduct?.id,
        },
        locale,
      );
      setTestResult({
        size: json.size,
        // Tester pokazuje pełne uzasadnienie na liczbach (do strojenia),
        // nie skrócony nagłówek dla kupującego.
        explanation: json.explanationDetail || json.explanation,
        usedBrandStyle: Boolean(json.usedBrandStyle),
        productTitle: json.productTitle ?? null,
        usedProductChart: Boolean(json.usedProductChart),
      });
    } catch (err) {
      setTestError(
        err instanceof Error && err.message ? err.message : t("settings.error.testFailed"),
      );
    } finally {
      setTesting(false);
    }
  };

  const notesDirty = styleNotes !== savedNotes;
  const langDirty = lang !== language;
  const testInputsValid = Number(testHeight) > 0 && Number(testWeight) > 0;

  return (
    <Page title={t("settings.title")} subtitle={t("settings.subtitle")}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("settings.language.title")}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  {t("settings.language.desc")}
                </Text>
                <InlineStack gap="400" blockAlign="end" wrap>
                  <InlineStack gap="300" blockAlign="end" wrap={false}>
                    <Box minWidth="240px">
                      <Select
                        label={t("settings.language.label")}
                        options={[
                          { label: t("settings.language.auto"), value: "auto" },
                          { label: t("settings.language.pl"), value: "pl" },
                          { label: t("settings.language.en"), value: "en" },
                        ]}
                        value={lang}
                        onChange={setLang}
                      />
                    </Box>
                    <Button
                      variant="primary"
                      onClick={saveLang}
                      loading={savingLang}
                      disabled={!langDirty}
                    >
                      {t("settings.brand.save")}
                    </Button>
                  </InlineStack>
                  <Box minWidth="240px">
                    <Select
                      label={t("settings.widgetLang.label")}
                      options={[
                        { label: t("settings.widgetLang.auto"), value: "auto" },
                        { label: "Polski", value: "pl" },
                        { label: "English", value: "en" },
                      ]}
                      value={widgetLang}
                      onChange={changeWidgetLang}
                      disabled={savingWidgetLang}
                    />
                  </Box>
                </InlineStack>
                {langError ? (
                  <Text as="p" tone="critical" variant="bodySm">
                    {langError}
                  </Text>
                ) : null}
                {widgetLangError ? (
                  <Text as="p" tone="critical" variant="bodySm">
                    {widgetLangError}
                  </Text>
                ) : null}
                <Text as="p" tone="subdued" variant="bodySm">
                  {t("settings.widgetLang.desc")}{" "}
                  {shopperLangSwitch
                    ? t("settings.widgetLang.shopperOn")
                    : t("settings.widgetLang.shopperOff")}
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("settings.brand.title")}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  {t("settings.brand.desc")}
                </Text>
                <TextField
                  label={t("settings.brand.label")}
                  labelHidden
                  value={styleNotes}
                  onChange={setStyleNotes}
                  multiline={3}
                  autoComplete="off"
                  maxLength={500}
                  showCharacterCount
                  placeholder={t("settings.brand.placeholder")}
                />
                {notesError ? (
                  <Text as="p" tone="critical" variant="bodySm">
                    {notesError}
                  </Text>
                ) : null}
                <InlineStack align="start">
                  <Button
                    variant="primary"
                    onClick={saveNotes}
                    loading={savingNotes}
                    disabled={!notesDirty}
                  >
                    {notesDirty ? t("settings.brand.save") : t("settings.brand.saved")}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("settings.css.title")}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  {t("settings.css.desc")}
                </Text>
                {customCssAvailable ? (
                  <>
                    <TextField
                      label={t("settings.css.title")}
                      labelHidden
                      value={css}
                      onChange={setCss}
                      multiline={5}
                      autoComplete="off"
                      maxLength={8000}
                      monospaced
                      placeholder={t("settings.css.placeholder")}
                    />
                    {cssError ? (
                      <Text as="p" tone="critical" variant="bodySm">
                        {cssError}
                      </Text>
                    ) : null}
                    <InlineStack align="space-between" blockAlign="center">
                      <Button
                        variant="primary"
                        onClick={saveCss}
                        loading={savingCss}
                        disabled={css === savedCss}
                      >
                        {t("settings.brand.save")}
                      </Button>
                      <Button
                        variant="plain"
                        disclosure={cssRefOpen ? "up" : "down"}
                        onClick={() => setCssRefOpen((v) => !v)}
                      >
                        {t("settings.css.ref.toggle")}
                      </Button>
                    </InlineStack>
                    <Collapsible
                      open={cssRefOpen}
                      id="sa-css-ref"
                      transition={{ duration: "150ms", timingFunction: "ease" }}
                    >
                      <Box
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <pre
                          style={{
                            margin: 0,
                            fontSize: 12,
                            lineHeight: 1.6,
                            whiteSpace: "pre-wrap",
                            fontFamily:
                              "ui-monospace, SFMono-Regular, Menlo, monospace",
                          }}
                        >
                          {t("settings.css.classes")}
                        </pre>
                      </Box>
                    </Collapsible>
                  </>
                ) : (
                  <LockedFeature note={t("gate.locked_from", { plan: "Growth" })}>
                    <TextField
                      label={t("settings.css.title")}
                      labelHidden
                      value=""
                      onChange={() => {}}
                      multiline={3}
                      autoComplete="off"
                      placeholder={t("settings.css.placeholder")}
                    />
                  </LockedFeature>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("settings.fitPref.title")}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  {t("settings.fitPref.desc")}
                </Text>
                {fitPreferenceAvailable ? (
                  <>
                    <Checkbox
                      label={t("settings.fitPref.toggle")}
                      checked={fitPref}
                      onChange={toggleFitPref}
                      disabled={savingFitPref}
                    />
                    {fitPrefError ? (
                      <Text as="p" tone="critical" variant="bodySm">
                        {fitPrefError}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <LockedFeature note={t("gate.locked_from", { plan: "Growth" })}>
                    <Checkbox
                      label={t("settings.fitPref.toggle")}
                      checked={false}
                      onChange={() => {}}
                    />
                  </LockedFeature>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("settings.garment.title")}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  {t("settings.garment.desc")}
                </Text>
                {garmentMatchAvailable ? (
                  <>
                    <Checkbox
                      label={t("settings.garment.toggle")}
                      checked={garment}
                      onChange={toggleGarment}
                      disabled={savingGarment}
                    />
                    {garmentError ? (
                      <Text as="p" tone="critical" variant="bodySm">
                        {garmentError}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <LockedFeature note={t("gate.locked_from", { plan: "Growth" })}>
                    <Checkbox
                      label={t("settings.garment.toggle")}
                      checked={false}
                      onChange={() => {}}
                    />
                  </LockedFeature>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("settings.returnRate.title")}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  {t("settings.returnRate.desc")}
                </Text>
                {analyticsAvailable ? (
                  <>
                    <InlineStack gap="300" blockAlign="end" wrap>
                      <Box minWidth="160px">
                        <TextField
                          label={t("settings.returnRate.label")}
                          type="number"
                          suffix="%"
                          min={0}
                          max={100}
                          value={returnRate}
                          onChange={setReturnRate}
                          autoComplete="off"
                        />
                      </Box>
                      <Button
                        variant="primary"
                        onClick={saveReturnRate}
                        loading={savingReturnRate}
                        disabled={returnRate === savedReturnRate}
                      >
                        {t("settings.brand.save")}
                      </Button>
                    </InlineStack>
                    {returnRateError ? (
                      <Text as="p" tone="critical" variant="bodySm">
                        {returnRateError}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <LockedFeature note={t("gate.locked_from", { plan: "Growth" })}>
                    <TextField
                      label={t("settings.returnRate.label")}
                      type="number"
                      suffix="%"
                      value=""
                      onChange={() => {}}
                      autoComplete="off"
                    />
                  </LockedFeature>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    {t("settings.tester.title")}
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {t("settings.tester.desc")}
                  </Text>
                </BlockStack>

                {!promptTester ? (
                  <InlineStack gap="150" blockAlign="center">
                    <Link
                      to="/app/plans"
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      {t("gate.upgrade")}
                    </Link>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {t("gate.tester_locked")}
                    </Text>
                  </InlineStack>
                ) : null}

                <div
                  style={
                    promptTester
                      ? undefined
                      : {
                          opacity: 0.4,
                          pointerEvents: "none",
                          userSelect: "none",
                          filter: "grayscale(1)",
                        }
                  }
                >
                  <BlockStack gap="400">

                <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
                  <TextField
                    label={t("settings.tester.height")}
                    type="number"
                    value={testHeight}
                    onChange={setTestHeight}
                    autoComplete="off"
                  />
                  <TextField
                    label={t("settings.tester.weight")}
                    type="number"
                    value={testWeight}
                    onChange={setTestWeight}
                    autoComplete="off"
                  />
                  <Select
                    label={t("settings.tester.gender")}
                    options={[
                      { label: t("settings.gender.male"), value: "male" },
                      { label: t("settings.gender.female"), value: "female" },
                    ]}
                    value={testGender}
                    onChange={setTestGender}
                  />
                  <Select
                    label={t("settings.tester.body")}
                    options={[
                      { label: t("settings.body.slim"), value: "slim" },
                      { label: t("settings.body.standard"), value: "standard" },
                      { label: t("settings.body.athletic"), value: "athletic" },
                      { label: t("settings.body.plus"), value: "plus" },
                    ]}
                    value={testBody}
                    onChange={setTestBody}
                  />
                </InlineGrid>

                <Select
                  label={t("settings.tester.fit")}
                  options={[
                    { label: t("settings.tester.fit.none"), value: "" },
                    { label: t("settings.tester.fit.fitted"), value: "fitted" },
                    { label: t("settings.tester.fit.regular"), value: "regular" },
                    { label: t("settings.tester.fit.loose"), value: "loose" },
                  ]}
                  value={testFit}
                  onChange={setTestFit}
                />

                {garmentMatchAvailable ? (
                  <BlockStack gap="150">
                    <Text as="span" variant="bodyMd" fontWeight="medium">
                      {t("settings.tester.ref")}
                    </Text>
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                      <TextField
                        label={t("settings.tester.refBrand")}
                        labelHidden
                        placeholder={t("settings.tester.refBrand")}
                        autoComplete="off"
                        value={testRefBrand}
                        onChange={setTestRefBrand}
                      />
                      <TextField
                        label={t("settings.tester.refSize")}
                        labelHidden
                        placeholder={t("settings.tester.refSize")}
                        autoComplete="off"
                        value={testRefSize}
                        onChange={setTestRefSize}
                      />
                    </InlineGrid>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {t("settings.tester.refHint")}
                    </Text>
                  </BlockStack>
                ) : null}

                <BlockStack gap="150">
                  <Text as="span" variant="bodyMd" fontWeight="medium">
                    {t("settings.tester.product")}
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Button onClick={pickTestProduct} variant="secondary" size="slim">
                      {testProduct
                        ? t("settings.tester.changeProduct")
                        : t("settings.tester.pickProduct")}
                    </Button>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {testProduct ? testProduct.title : t("settings.tester.noProduct")}
                    </Text>
                    {testProduct ? (
                      <Button
                        variant="plain"
                        tone="critical"
                        onClick={() => setTestProduct(null)}
                      >
                        {t("settings.tester.clearProduct")}
                      </Button>
                    ) : null}
                  </InlineStack>
                </BlockStack>

                <InlineStack align="start">
                  <Button
                    onClick={runTest}
                    loading={testing}
                    disabled={!testInputsValid}
                    variant="primary"
                  >
                    {t("settings.tester.run")}
                  </Button>
                </InlineStack>

                {testError ? (
                  <Text as="p" tone="critical" variant="bodySm">
                    {testError}
                  </Text>
                ) : null}

                {testResult ? (
                  <Box
                    padding="400"
                    background="bg-surface-secondary"
                    borderRadius="200"
                    borderColor="border"
                    borderWidth="025"
                  >
                    <BlockStack gap="200">
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {t("settings.tester.resultSize", { size: testResult.size })}
                      </Text>
                      <Text as="p" variant="bodyMd">
                        {testResult.explanation}
                      </Text>
                      <InlineStack gap="150" wrap>
                        <Badge tone="info">
                          {testResult.productTitle
                            ? t("settings.tester.testedOn", {
                                product: testResult.productTitle,
                              })
                            : t("settings.tester.testedGeneric")}
                        </Badge>
                        {testResult.productTitle ? (
                          <Badge
                            tone={testResult.usedProductChart ? "success" : undefined}
                          >
                            {testResult.usedProductChart
                              ? t("settings.tester.withChart")
                              : t("settings.tester.noChart")}
                          </Badge>
                        ) : null}
                        <Badge
                          tone={testResult.usedBrandStyle ? "success" : undefined}
                        >
                          {testResult.usedBrandStyle
                            ? t("settings.tester.usedBrand")
                            : t("settings.tester.noBrand")}
                        </Badge>
                      </InlineStack>
                    </BlockStack>
                  </Box>
                ) : null}
                  </BlockStack>
                </div>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
