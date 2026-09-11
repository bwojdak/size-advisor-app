import { BlockStack, Box, Spinner, Text } from "@shopify/polaris";
import { useI18n } from "../lib/i18n";

// Kształt zwracany przez /app/check-consistency — trzymany tu jako lokalny
// typ (nie importujemy size-advisor.server.ts, to plik server-only i nie da
// się go wciągnąć do bundla klienta w tym setupie React Routera).
export type ConsistencyIssue = {
  axis: "height" | "weight";
  gender: "male" | "female";
  build: string;
  from: { point: number; size: string };
  to: { point: number; size: string };
};

/** Wynik testu spójności (patrz checkConsistency w silniku) — bateria
 *  sylwetek testowych przez resolveSize, bez AI. Pokazuje, czy przy
 *  rosnącym wzroście/wadze rozmiar gdziekolwiek się cofa; to klasa błędów
 *  niewidoczna przy patrzeniu na same liczby w tabeli. */
export function ConsistencyCheck({
  issues,
  tested,
  checking,
}: {
  issues: ConsistencyIssue[] | null;
  tested: number;
  checking: boolean;
}) {
  const { t } = useI18n();
  if (!checking && issues === null) return null;

  return (
    <Box
      padding="200"
      background={
        checking
          ? "bg-surface-secondary"
          : issues && issues.length > 0
            ? "bg-surface-caution"
            : "bg-surface-success"
      }
      borderRadius="100"
    >
      <BlockStack gap="100">
        <Text as="span" variant="bodyXs" fontWeight="medium">
          {t("consistency.title")}
        </Text>
        {checking ? (
          <Box>
            <Spinner size="small" accessibilityLabel={t("consistency.checking")} />
          </Box>
        ) : issues && issues.length > 0 ? (
          <BlockStack gap="050">
            <Text as="span" variant="bodyXs" tone="caution">
              {t("consistency.issues", { n: issues.length })}
            </Text>
            {issues.slice(0, 6).map((issue, i) => (
              <Text key={i} as="span" variant="bodyXs" tone="caution">
                •{" "}
                {t("consistency.issue", {
                  axis: t(`consistency.axis.${issue.axis}`),
                  from: issue.from.point,
                  to: issue.to.point,
                  gender: t(`consistency.gender.${issue.gender}`),
                  build: t(`consistency.build.${issue.build}`),
                  fromSize: issue.from.size,
                  toSize: issue.to.size,
                })}
              </Text>
            ))}
          </BlockStack>
        ) : (
          <Text as="span" variant="bodyXs" tone="success">
            {t("consistency.ok", { n: tested })}
          </Text>
        )}
      </BlockStack>
    </Box>
  );
}
