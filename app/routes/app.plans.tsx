import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  ButtonGroup,
  Card,
  InlineGrid,
  InlineStack,
  Layout,
  Modal,
  Page,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import { authenticate, unauthenticated, BILLING_IS_TEST } from "../shopify.server";
import {
  PLAN,
  PLAN_CAPS,
  PLAN_FEATURES,
  PLAN_LIMITS,
  PLAN_PRICE,
  PLAN_PRICE_ANNUAL,
  type BillingInterval,
} from "../lib/plans";
import db from "../db.server";
import { loadShopSettings } from "../lib/shop-settings.server";
import { useI18n } from "../lib/i18n";

const PLAN_ORDER = [PLAN.FREE, PLAN.STARTER, PLAN.GROWTH, PLAN.PRO] as const;

async function triggerBilling(
  query: string,
): Promise<{ outcome: "redirect" | "ok" | "error"; message?: string }> {
  const api = (window as unknown as { shopify?: { idToken: () => Promise<string> } }).shopify;
  const token = api ? await api.idToken() : null;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`/app/billing?${query}`, { headers });
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);

  if (res.ok) {
    if (typeof body.confirmationUrl === "string") {
      // Przekierowanie top-level na hostowany przez Shopify ekran akceptacji.
      (window.top ?? window).location.href = body.confirmationUrl;
      return { outcome: "redirect" };
    }
    return { outcome: "ok" };
  }

  console.error("[billing] request failed", res.status, body);
  return { outcome: "error", message: body?.error as string | undefined };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  let settings = await loadShopSettings(session.shop);

  let active:
    | { id: string; name?: string; status?: string; currentPeriodEnd?: string }
    | undefined;
  let billingError: string | null = null;

  try {
    // Surowy token offline (jak GraphiQL) zamiast billing.check na sesji z token
    // exchange, która zwracała 403 na zapytaniach bilingu.
    const { admin } = await unauthenticated.admin(session.shop);
    const resp = await admin.graphql(
      `#graphql
      {
        currentAppInstallation {
          activeSubscriptions { id name status currentPeriodEnd }
        }
      }`,
    );
    const gql = await resp.json();
    const subs: Array<{
      id: string;
      name?: string;
      status?: string;
      currentPeriodEnd?: string;
    }> = gql?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    active = subs.find((s) => s.status === "ACTIVE") ?? subs[0];

    const resolvedPlan =
      active?.name && PLAN_LIMITS[active.name] ? active.name : PLAN.FREE;

    // Uzgodnij bazę z prawdą po stronie Shopify (dubluje webhook, ale łapie
    // sytuacje, w których webhook nie dotarł).
    if (
      settings.plan !== resolvedPlan ||
      settings.monthlyLimit !== PLAN_LIMITS[resolvedPlan] ||
      (settings.subscriptionId ?? null) !== (active?.id ?? null)
    ) {
      settings = await db.shopSettings.update({
        where: { id: settings.id },
        data: {
          plan: resolvedPlan,
          monthlyLimit: PLAN_LIMITS[resolvedPlan],
          subscriptionId: active?.id ?? null,
        },
      });
    }
  } catch (err) {
    // Biling może być jeszcze niedostępny (np. świeża publiczna dystrybucja się
    // propaguje). Nie wywalaj strony — pokaż plany z danych z bazy.
    console.error("[plans] billing.check failed:", err);
    billingError = err instanceof Error ? err.message : String(err);
  }

  return {
    currentPlan: settings.plan,
    requestsUsed: settings.requestsUsed,
    monthlyLimit: settings.monthlyLimit,
    renewsOn: active?.currentPeriodEnd ?? null,
    isTest: BILLING_IS_TEST,
    billingError,
  };
};

export default function PlansPage() {
  const { currentPlan, requestsUsed, monthlyLimit, renewsOn, isTest, billingError } =
    useLoaderData<typeof loader>();
  const { t } = useI18n();
  const revalidator = useRevalidator();
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDowngrade, setConfirmDowngrade] = useState(false);
  const [interval, setInterval] = useState<BillingInterval>("monthly");

  const usagePercent = Math.min(
    Math.round((requestsUsed / Math.max(monthlyLimit, 1)) * 100),
    100,
  );

  // Starter/Growth/Pro mają identyczne funkcje (patrz PAID_TIER_CAPS w
  // plans.ts) — różni je tylko wolumen. Zamiast powtarzać tę samą listę na
  // trzech kartach, pokazujemy ją RAZ nad kartami, a na kartach zostaje
  // tylko to, co faktycznie się różni (liczba rekomendacji). Lista bierze
  // się z PLAN_FEATURES[Starter] (tam trzymana jest kompletna, bo to Starter
  // pokazuje ją, gdy ktoś patrzy z osobna) minus wiersz z liczbą rekomendacji.
  const paidSharedFeatures = PLAN_FEATURES[PLAN.STARTER].filter(
    (key) => key !== "plans.feat.rec",
  );

  const prevLabel: Record<string, string> = {
    [PLAN.STARTER]: "Free",
  };

  const featText = (plan: string, key: string): string => {
    const caps = PLAN_CAPS[plan];
    if (key === "plans.feat.rec")
      return t(key, { n: caps.monthlyLimit.toLocaleString() });
    if (key === "plans.feat.products_limited")
      return t(key, { n: caps.productRuleLimit });
    if (key === "plans.feat.history_days") return t(key, { n: caps.historyDays });
    return t(key);
  };

  const onChoose = (plan: string) => {
    if (plan === PLAN.FREE) {
      setConfirmDowngrade(true);
      return;
    }
    choosePlan(plan);
  };

  const choosePlan = async (plan: string) => {
    setConfirmDowngrade(false);
    setBusyPlan(plan);
    setError(null);
    try {
      const query =
        plan === PLAN.FREE
          ? "intent=cancel"
          : `intent=subscribe&plan=${encodeURIComponent(plan)}&interval=${interval}`;
      const { outcome, message } = await triggerBilling(query);
      if (outcome === "ok") {
        revalidator.revalidate();
      } else if (outcome === "error") {
        setError(message || t("settings.error.saveFailed"));
      }
      // "redirect" — strona jest właśnie przenoszona na ekran Shopify
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.error.saveFailed"));
    } finally {
      setBusyPlan(null);
    }
  };

  return (
    <Page title={t("plans.title")} subtitle={t("plans.subtitle")}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {billingError ? (
              <Banner tone="warning">{t("plans.billingUnavailable")}</Banner>
            ) : null}
            {error ? (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                {error}
              </Banner>
            ) : null}

            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodyMd" fontWeight="medium">
                    {t("plans.usage", { used: requestsUsed, limit: monthlyLimit })}
                  </Text>
                  {renewsOn ? (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {t("plans.renews", {
                        date: new Date(renewsOn).toLocaleDateString(),
                      })}
                    </Text>
                  ) : null}
                </InlineStack>
                <ProgressBar
                  progress={usagePercent}
                  size="small"
                  tone={usagePercent > 85 ? "critical" : "primary"}
                />
                <Text as="p" variant="bodyXs" tone="subdued">
                  {t("plans.usage.cacheNote")}
                </Text>
              </BlockStack>
            </Card>

            <InlineStack align="center">
              <ButtonGroup variant="segmented">
                <Button
                  pressed={interval === "monthly"}
                  onClick={() => setInterval("monthly")}
                >
                  {t("plans.interval.monthly")}
                </Button>
                <Button
                  pressed={interval === "annual"}
                  onClick={() => setInterval("annual")}
                >
                  {t("plans.interval.annual")}
                </Button>
              </ButtonGroup>
            </InlineStack>

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  {t("plans.paidShared.title")}
                </Text>
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="150">
                  {paidSharedFeatures.map((key) => (
                    <Text as="p" variant="bodySm" key={key}>
                      ✓ {t(key)}
                    </Text>
                  ))}
                </InlineGrid>
                <Text as="p" variant="bodyXs" tone="subdued">
                  {t("plans.paidShared.note")}
                </Text>
              </BlockStack>
            </Card>

            <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
              {PLAN_ORDER.map((plan) => {
                const isCurrent = plan === currentPlan;
                const annual = interval === "annual";
                const perMonth =
                  plan === PLAN.FREE
                    ? 0
                    : annual
                      ? PLAN_PRICE_ANNUAL[plan] / 12
                      : PLAN_PRICE[plan];
                const price =
                  plan === PLAN.FREE
                    ? t("plans.free_price")
                    : t("plans.price_month", { amount: perMonth.toFixed(2) });

                return (
                  <Card key={plan}>
                    <BlockStack gap="300">
                      <BlockStack gap="100">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h3" variant="headingMd">
                            {plan === PLAN.FREE ? "Free" : plan}
                          </Text>
                          {isCurrent ? (
                            <Badge tone="success">{t("plans.current")}</Badge>
                          ) : null}
                        </InlineStack>
                        <Text as="p" variant="headingLg" fontWeight="bold">
                          {price}
                        </Text>
                        {plan !== PLAN.FREE && annual ? (
                          <Text as="p" variant="bodyXs" tone="subdued">
                            {t("plans.billed_annually", {
                              amount: PLAN_PRICE_ANNUAL[plan].toFixed(2),
                            })}{" "}
                            · {t("plans.save_annual")}
                          </Text>
                        ) : null}
                      </BlockStack>

                      {plan !== PLAN.FREE ? (
                        <Text as="p" variant="bodyXs" tone="subdued">
                          {t("plans.trial")}
                        </Text>
                      ) : null}

                      <BlockStack gap="150">
                        {plan === PLAN.FREE ? (
                          PLAN_FEATURES[plan].map((key) => (
                            <Text as="p" variant="bodySm" key={key}>
                              ✓ {featText(plan, key)}
                            </Text>
                          ))
                        ) : (
                          <>
                            {plan === PLAN.STARTER ? (
                              <Text
                                as="p"
                                variant="bodyXs"
                                tone="subdued"
                                fontWeight="medium"
                              >
                                {t("plans.includes_prev", { plan: prevLabel[plan] })}
                              </Text>
                            ) : null}
                            {/* Starter/Growth/Pro mają te same funkcje (patrz
                                karta wyżej) — jedyna różnica to wolumen, więc
                                to jedyne, co tu pokazujemy. */}
                            <Text as="p" variant="bodyMd" fontWeight="semibold">
                              ✓ {featText(plan, "plans.feat.rec")}
                            </Text>
                          </>
                        )}
                      </BlockStack>

                      {isCurrent ? (
                        <Button disabled fullWidth>
                          {t("plans.yourPlan")}
                        </Button>
                      ) : (
                        <Button
                          fullWidth
                          variant={plan === PLAN.FREE ? "secondary" : "primary"}
                          loading={busyPlan === plan}
                          disabled={busyPlan !== null && busyPlan !== plan}
                          onClick={() => onChoose(plan)}
                        >
                          {plan === PLAN.FREE ? t("plans.downgrade") : t("plans.select")}
                        </Button>
                      )}
                    </BlockStack>
                  </Card>
                );
              })}
            </InlineGrid>

            {isTest ? (
              <Text as="p" variant="bodyXs" tone="subdued">
                {t("plans.test_notice")}
              </Text>
            ) : null}
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Modal
        open={confirmDowngrade}
        onClose={() => setConfirmDowngrade(false)}
        title={t("plans.downgrade.confirmTitle")}
        primaryAction={{
          content: t("plans.downgrade"),
          destructive: true,
          loading: busyPlan === PLAN.FREE,
          onAction: () => choosePlan(PLAN.FREE),
        }}
        secondaryActions={[
          { content: t("common.cancel"), onAction: () => setConfirmDowngrade(false) },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            {t("plans.downgrade.confirmBody")}
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
