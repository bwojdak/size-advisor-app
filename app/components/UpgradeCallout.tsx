import { BlockStack, Box, Button, Card, Text } from "@shopify/polaris";
import { useI18n } from "../lib/i18n";

/** Zablokowana funkcja + CTA do planów. */
export function UpgradeCallout({
  title,
  body,
  compact = false,
}: {
  title: string;
  body: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const content = (
    <BlockStack gap="200">
      <Text as="h3" variant="headingSm">
        {title}
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        {body}
      </Text>
      <Box paddingBlockStart="100">
        <Button url="/app/plans" variant="primary" size="slim">
          {t("gate.see_plans")}
        </Button>
      </Box>
    </BlockStack>
  );

  return compact ? content : <Card>{content}</Card>;
}
