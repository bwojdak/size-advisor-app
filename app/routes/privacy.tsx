import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [
  { title: "Privacy Policy — Size Advisor" },
];

// Publiczna strona polityki prywatności — URL do podania w listingu App Store
// oraz w formularzu Protected Customer Data (https://<app-url>/privacy).
// Zaktualizuj datę "Last updated" przy każdej istotnej zmianie.
export default function PrivacyPolicy() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 20px 80px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        lineHeight: 1.6,
        color: "#202223",
      }}
    >
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Privacy Policy — Size Advisor</h1>
      <p style={{ color: "#6d7175", marginTop: 0 }}>
        Last updated: September 6, 2026 · Provided by Bartosz Wojdak
      </p>

      <h2>1. Overview</h2>
      <p>
        Size Advisor (“the App”) is a Shopify app that shows shoppers an AI size
        recommendation on product pages and gives the merchant analytics about how
        those recommendations perform. This policy explains what personal data the
        App processes, why, and how it is protected.
      </p>

      <h2>2. Data we process</h2>
      <ul>
        <li>
          <strong>Shopper-provided inputs.</strong> Height, weight, selected
          gender and body type entered into the size widget. This is used only to
          generate the size recommendation for that request.
        </li>
        <li>
          <strong>Product context.</strong> The title and description of the
          product being viewed, and the merchant’s configured size charts / notes.
        </li>
        <li>
          <strong>Order metadata (protected customer data).</strong> Via the
          Shopify <code>orders/create</code> webhook we read only line-item
          properties to find a hidden marker (<code>_size_advisor</code>) that
          links a purchase to an earlier recommendation, and we store the order
          ID and a “purchased” flag. <strong>We do not receive, use, or store
          customer names, email addresses, phone numbers, shipping/billing
          addresses, or payment details.</strong>
        </li>
        <li>
          <strong>Merchant / store data.</strong> Shop domain, app settings
          (brand fit notes, per-product configuration, plan) and the Shopify
          session token required to operate the app.
        </li>
      </ul>

      <h2>3. How we use it</h2>
      <ul>
        <li>Generate size recommendations for shoppers.</li>
        <li>
          Provide merchants with aggregate performance metrics: number of
          recommendations, add-to-cart rate, purchases attributed to a
          recommendation, and an estimated reduction in size-related returns.
        </li>
      </ul>
      <p>
        We do not use personal data for any other purpose, we do not sell
        personal data, and we do not use it for advertising or marketing.
      </p>

      <h2>4. Sub-processors</h2>
      <ul>
        <li>
          <strong>AI provider (OpenAI).</strong> To produce the size suggestion,
          the App sends a prompt containing the shopper’s entered measurements
          (height, weight, gender, body type, optional fit preference) together
          with product information (title, description, size chart) to OpenAI’s
          API. The prompt contains <strong>no customer name, email, address, or
          any identifier</strong> — only anonymous body measurements and public
          product data. Google’s Gemini API may be used as an alternative
          provider with the same data scope. Data sent to the AI provider is
          handled under that provider’s API data-usage terms.
        </li>
        <li>
          <strong>Shopify.</strong> The platform the App runs on and receives
          webhooks from.
        </li>
        <li>
          <strong>The App’s hosting provider.</strong> Runs the App server and
          database on our behalf.
        </li>
      </ul>

      <h2>5. Retention</h2>
      <p>
        Recommendation records (including the shopper measurements above) are
        retained for at most ~13 months and are then deleted automatically. App
        settings are kept while the App is installed. When a merchant uninstalls
        the App, session data is deleted and remaining store data is removed in
        response to Shopify’s <code>shop/redact</code> request.
      </p>

      <h2>6. Data subject requests</h2>
      <p>
        We honour Shopify’s privacy webhooks:{" "}
        <code>customers/data_request</code>, <code>customers/redact</code> and{" "}
        <code>shop/redact</code>. Merchants and shoppers can also contact us at{" "}
        <a href="mailto:bartek.wojdak11@gmail.com">bartek.wojdak11@gmail.com</a> to
        access or delete data associated with a store.
      </p>

      <h2>7. Security</h2>
      <p>
        All data is transmitted over HTTPS/TLS. In production the database
        encrypts data at rest. Access to production systems is limited to
        authorised personnel.
      </p>

      <h2>8. Changes</h2>
      <p>
        We may update this policy; the “Last updated” date above reflects the
        latest version. Material changes will be communicated to merchants through
        the App or by email.
      </p>

      <h2>9. Contact</h2>
      <p>
        Bartosz Wojdak ·{" "}
        <a href="mailto:bartek.wojdak11@gmail.com">bartek.wojdak11@gmail.com</a>
      </p>
    </main>
  );
}
