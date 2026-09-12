import { useState, useEffect } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useSearchParams } from "react-router";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Banner,
  ProgressBar,
  Box,
  Icon,
  IndexTable,
  InlineGrid,
  Tooltip,
} from "@shopify/polaris";
import { CheckCircleIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadShopSettings } from "../lib/shop-settings.server";
import { PLAN, planCaps } from "../lib/plans";
import { useI18n } from "../lib/i18n";
import { LockedFeature } from "../components/LockedFeature";

declare global {
  interface Window {
    shopify?: {
      idToken: () => Promise<string>;
    };
  }
}

const RECENT_LIMIT = 5;
const WINDOW_MAX_ROWS = 500;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await loadShopSettings(session.shop);
  const caps = planCaps(settings.plan);

  const expanded =
    caps.historyDays > 0 &&
    new URL(request.url).searchParams.get("view") === "all";
  const since = new Date();
  since.setDate(since.getDate() - caps.historyDays);

  const [logs, windowCount, analytics] = await Promise.all([
    db.advisorLog.findMany({
      where: {
        shopId: settings.id,
        ...(expanded ? { createdAt: { gte: since } } : {}),
      },
      take: expanded ? WINDOW_MAX_ROWS : RECENT_LIMIT,
      orderBy: { createdAt: "desc" },
    }),
    caps.historyDays > 0
      ? db.advisorLog.count({
          where: { shopId: settings.id, createdAt: { gte: since } },
        })
      : db.advisorLog.count({ where: { shopId: settings.id } }),
    caps.conversionAnalytics
      ? Promise.all([
          db.advisorLog.count({ where: { shopId: settings.id, addedToCart: true } }),
          db.advisorLog.count({ where: { shopId: settings.id, purchased: true } }),
        ])
      : Promise.resolve([0, 0] as [number, number]),
  ]);
  const [addedToCartCount, purchasedCount] = analytics;

  return {
    settings,
    logs,
    windowCount,
    historyDays: caps.historyDays,
    expanded,
    conversionAnalytics: caps.conversionAnalytics,
    csvExport: caps.csvExport,
    addedToCartCount,
    purchasedCount,
  };
};

export default function Index() {
  const {
    settings,
    logs,
    windowCount,
    historyDays,
    expanded,
    conversionAnalytics,
    csvExport,
    addedToCartCount,
    purchasedCount,
  } = useLoaderData<typeof loader>();
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();

  const [isEnabled, setIsEnabled] = useState(settings.isEnabled);
  const [isSaving, setIsSaving] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(false);

  useEffect(() => {
    setIsClient(true);
    try {
      setSetupDismissed(localStorage.getItem("sa-setup-dismissed") === "1");
    } catch {
      /* private mode / blocked storage — just show the tip */
    }
  }, []);

  const dismissSetup = () => {
    setSetupDismissed(true);
    try {
      localStorage.setItem("sa-setup-dismissed", "1");
    } catch {
      /* ignore */
    }
  };

  const [csvBusy, setCsvBusy] = useState(false);
  const downloadCsv = async () => {
    setCsvBusy(true);
    setToggleError(null);
    try {
      const token = await window.shopify?.idToken();
      const res = await fetch("/app/export", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `size-advisor-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setToggleError(t("analytics.csv.error"));
    } finally {
      setCsvBusy(false);
    }
  };

  const themeEditorUrl = `https://${settings.shop}/admin/themes/current/editor?template=product`;
  const showSetup = isClient && !setupDismissed && windowCount === 0;

  const handleToggle = async () => {
    const nextState = !isEnabled;
    setIsSaving(true);

    try {
      const token = await window.shopify?.idToken();

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch("/app/toggle", {
        method: "POST",
        headers,
        body: JSON.stringify({ isEnabled: nextState }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const text = await res.text();
        console.error("Serwer nie zwrócił JSON, status:", res.status, text.slice(0, 200));
        throw new Error(`Nieoczekiwana odpowiedź serwera (status ${res.status})`);
      }

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Status ${res.status}`);
      }

      const data = await res.json();
      if (data.success) {
        setIsEnabled(data.isEnabled);
      }
      setToggleError(null);
    } catch (err) {
      console.error("Błąd zapisu statusu:", err);
      setToggleError(
        err instanceof Error && err.message
          ? err.message
          : t("settings.error.saveFailed"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const toggleView = () => {
    const next = new URLSearchParams(searchParams);
    if (expanded) {
      next.delete("view");
    } else {
      next.set("view", "all");
    }
    setSearchParams(next, { preventScrollReset: true });
  };

  const currentUsage = settings.requestsUsed;
  const currentLimit = settings.monthlyLimit;
  const usagePercent = Math.min(Math.round((currentUsage / currentLimit) * 100), 100);

  const resourceName = {
    singular: t("index.resource.singular"),
    plural: t("index.resource.plural"),
  };

  return (
    <Page
      title="AI Size Advisor"
      subtitle={t("index.subtitle")}
      primaryAction={{
        content: isEnabled ? t("index.action.disable") : t("index.action.enable"),
        destructive: isEnabled,
        onAction: handleToggle,
        loading: isSaving,
      }}
    >
      <BlockStack gap="500">
        {toggleError ? (
          <Banner tone="critical" onDismiss={() => setToggleError(null)}>
            {toggleError}
          </Banner>
        ) : null}

        {showSetup ? (
          <Card>
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  {t("setup.title")}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  {t("setup.desc")}
                </Text>
              </BlockStack>

              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="start" wrap={false}>
                  <Box>
                    <Icon
                      source={CheckCircleIcon}
                      tone={isEnabled ? "success" : "subdued"}
                    />
                  </Box>
                  <Text as="p" variant="bodyMd">
                    {isEnabled ? t("setup.step1.done") : t("setup.step1.todo")}
                  </Text>
                </InlineStack>

                <InlineStack gap="200" blockAlign="start" wrap={false}>
                  <Box>
                    <Icon source={CheckCircleIcon} tone="subdued" />
                  </Box>
                  <BlockStack gap="150">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {t("setup.step2.title")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("setup.step2.desc")}
                    </Text>
                    <InlineStack>
                      <Button url={themeEditorUrl} external variant="primary" size="slim">
                        {t("setup.step2.cta")}
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </InlineStack>

                <InlineStack gap="200" blockAlign="start" wrap={false}>
                  <Box>
                    <Icon source={CheckCircleIcon} tone="subdued" />
                  </Box>
                  <BlockStack gap="050">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {t("setup.step3.title")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("setup.step3.desc")}
                    </Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>

              <InlineStack align="end">
                <Button variant="plain" onClick={dismissSetup}>
                  {t("setup.dismiss")}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        ) : null}

        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">
                {t("index.card.recommendations.title")}
              </Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {currentUsage}
              </Text>
              <Text as="span" variant="bodyXs" tone="subdued">
                {t("index.card.recommendations.plan", {
                  plan: settings.plan.toUpperCase(),
                  used: currentUsage,
                  limit: currentLimit,
                })}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center" wrap={false}>
                <Text as="h3" variant="headingSm" tone="subdued">
                  {t("index.card.purchases.title")}
                </Text>
                {conversionAnalytics ? (
                  <Tooltip
                    content={t("index.card.purchases.tooltip")}
                    dismissOnMouseOut
                  >
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={t("index.card.purchases.helpAria")}
                      style={{
                        cursor: "help",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "16px",
                        height: "16px",
                        borderRadius: "50%",
                        border: "1px solid currentColor",
                        fontSize: "11px",
                        lineHeight: 1,
                        opacity: 0.6,
                      }}
                    >
                      ?
                    </span>
                  </Tooltip>
                ) : null}
              </InlineStack>
              {conversionAnalytics ? (
                <>
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {purchasedCount}
                  </Text>
                  <Text as="span" variant="bodyXs" tone="subdued">
                    {t("index.card.purchases.sub", {
                      cart: addedToCartCount,
                      returns: Math.round(purchasedCount * 0.3),
                    })}
                  </Text>
                </>
              ) : (
                <LockedFeature note={t("gate.locked_from", { plan: PLAN.STARTER })}>
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    —
                  </Text>
                </LockedFeature>
              )}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="h3" variant="headingSm" tone="subdued">
                  {t("index.card.status.title")}
                </Text>
                <Badge tone={isEnabled ? "success" : "critical"}>
                  {isEnabled
                    ? t("index.card.status.active")
                    : t("index.card.status.inactive")}
                </Badge>
              </InlineStack>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {isEnabled
                  ? t("index.card.status.visible")
                  : t("index.card.status.hidden")}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">
              {t("index.limit.title")}
            </Text>
            <Box paddingBlock="200">
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">
                    {t("index.limit.monthly")}
                  </Text>
                  <Text as="span" variant="bodySm" fontWeight="bold">
                    {currentUsage} / {currentLimit}
                  </Text>
                </InlineStack>
                <ProgressBar
                  progress={usagePercent}
                  size="small"
                  tone={usagePercent > 85 ? "critical" : "primary"}
                />
              </BlockStack>
            </Box>
            <InlineStack align="space-between" blockAlign="center">
              <Text tone="subdued" as="p" variant="bodySm">
                {t("index.limit.renew")}
              </Text>
              <Link
                to="/app/plans"
                style={{ fontSize: "13px", fontWeight: 600, textDecoration: "none" }}
              >
                {t("index.limit.upgrade")} →
              </Link>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card padding="0">
          <Box padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">
                      {expanded
                        ? t("index.queries.title.month")
                        : t("index.queries.title.recent")}
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {t("index.queries.count", { n: windowCount })}
                    </Text>
                  </BlockStack>
                  <InlineStack gap="300" blockAlign="center">
                    {csvExport ? (
                      <Button variant="plain" onClick={downloadCsv} loading={csvBusy}>
                        {t("index.queries.csv")}
                      </Button>
                    ) : null}
                    {historyDays > 0 && windowCount > RECENT_LIMIT ? (
                      <Button variant="plain" onClick={toggleView}>
                        {expanded
                          ? t("index.queries.showRecent")
                          : t("index.queries.showAll")}
                      </Button>
                    ) : null}
                  </InlineStack>
                </InlineStack>
              </Box>
              <IndexTable
                resourceName={resourceName}
                itemCount={logs.length}
                headings={[
                  { title: t("index.queries.col.product") },
                  { title: t("index.queries.col.customer") },
                  { title: t("index.queries.col.recommendation") },
                  { title: t("index.queries.col.date") },
                ]}
                selectable={false}
              >
                {logs.length > 0 ? (
                  logs.map((item, index) => (
                    <IndexTable.Row id={item.id} key={item.id} position={index}>
                      <IndexTable.Cell>
                        <div
                          title={item.productTitle || undefined}
                          style={{
                            maxWidth: 200,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <Text variant="bodyMd" fontWeight="bold" as="span">
                            {item.productTitle ||
                              t("index.queries.productFallback")}
                          </Text>
                        </div>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <span style={{ whiteSpace: "nowrap" }}>
                          {item.customerHeight} cm / {item.customerWeight} kg (
                          {item.bodyType || item.customerGender || "standard"})
                        </span>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <InlineStack gap="150" blockAlign="center">
                          <Badge tone="info">{item.recommendedSize}</Badge>
                          {item.addedToCart ? (
                            <Badge tone="success">
                              {t("index.queries.addedToCart")}
                            </Badge>
                          ) : null}
                        </InlineStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <span style={{ whiteSpace: "nowrap" }}>
                          {isClient
                            ? new Date(item.createdAt).toLocaleString(undefined, {
                                dateStyle: "short",
                                timeStyle: "short",
                              })
                            : ""}
                        </span>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))
                ) : (
                  <IndexTable.Row id="empty" position={0}>
                    <IndexTable.Cell colSpan={4}>
                      <Box padding="400">
                        <Text as="p" tone="subdued" alignment="center">
                          {t("index.queries.empty")}
                        </Text>
                      </Box>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                )}
              </IndexTable>
        </Card>
      </BlockStack>
    </Page>
  );
}
