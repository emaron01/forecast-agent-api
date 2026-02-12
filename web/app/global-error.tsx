"use client";

export default function GlobalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // This renders in production on fatal errors, replacing the generic
  // "client-side exception" screen with actionable info.
  // eslint-disable-next-line no-console
  console.error("Global app error:", props.error);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "ui-sans-serif, system-ui",
          padding: 24,
          background: "var(--sf-background)",
          color: "var(--sf-text-primary)",
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Application error</h1>
        <p style={{ marginBottom: 12 }}>
          Something went wrong while rendering this page. If this keeps happening, copy the details below and send them to support.
        </p>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "var(--sf-surface-alt)",
            color: "var(--sf-text-secondary)",
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--sf-border)",
            maxWidth: 900,
            overflow: "auto",
          }}
        >
          {String(props.error?.message || props.error)}
          {props.error?.digest ? `\n\ndigest: ${props.error.digest}` : ""}
          {props.error?.stack ? `\n\nstack:\n${props.error.stack}` : ""}
        </pre>
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() => props.reset()}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--sf-border)",
              background: "var(--sf-button-secondary-bg)",
              color: "var(--sf-button-secondary-text)",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

