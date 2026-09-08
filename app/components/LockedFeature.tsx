import type { ReactNode } from "react";
import { Link } from "react-router";
import { Icon, InlineStack, Text } from "@shopify/polaris";
import { LockIcon } from "@shopify/polaris-icons";
import { useI18n } from "../lib/i18n";

/**
 * Renderuje realną kontrolkę, ale wyszarzoną i nieaktywną, z małym linkiem
 * „Ulepsz swój plan". Do opcji zablokowanych w obrębie strony (nie całych stron).
 */
export function LockedFeature({
  children,
  note,
}: {
  children: ReactNode;
  note?: string;
}) {
  const { t } = useI18n();
  return (
    <div>
      <InlineStack gap="150" blockAlign="center">
        <span style={{ display: "inline-flex", opacity: 0.6 }}>
          <Icon source={LockIcon} tone="subdued" />
        </span>
        <Link
          to="/app/plans"
          style={{ fontSize: 13, fontWeight: 600, textDecoration: "none" }}
        >
          {t("gate.upgrade")}
        </Link>
        {note ? (
          <Text as="span" variant="bodySm" tone="subdued">
            {note}
          </Text>
        ) : null}
      </InlineStack>
      <div
        aria-hidden="true"
        style={{
          opacity: 0.4,
          pointerEvents: "none",
          userSelect: "none",
          marginTop: 8,
          filter: "grayscale(1)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
