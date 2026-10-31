import { useRef, useState } from "react";

interface InvoiceSummary {
  id: string;
  number: string;
  subscriptionNumber: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  currencyCode: string;
  total: string;
}

interface BillingSkip {
  subscriptionId: string;
  subscriptionNumber: string;
  reason: string;
  details: string;
}

interface BillingPreview {
  asOf: string;
  candidates: Array<{
    subscriptionId: string;
    subscriptionNumber: string;
    invoice: {
      subtotal: string;
      discountTotal: string;
      taxTotal: string;
      total: string;
      currencyCode: string;
    } | null;
    skipped: BillingSkip | null;
  }>;
  totals: { subtotal: string; discount: string; tax: string; total: string };
  skipped: BillingSkip[];
  warnings: Array<{
    subscriptionNumber: string;
    productId: string;
    description: string;
    costAmount: string;
    netAfterDiscount: string;
  }>;
}

interface BillingRun {
  created: InvoiceSummary[];
  skipped: BillingSkip[];
  totals: { subtotal: string; discount: string; tax: string; total: string };
  warnings: BillingPreview["warnings"];
}

interface ApiError {
  error?: { message?: string; details?: string[] };
}

async function postJson<T>(
  path: string,
  options: { body?: object; headers?: Record<string, string> } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify(options.body ?? {}),
  });
  const result = (await response.json()) as T & ApiError;
  if (!response.ok) {
    const message =
      result.error?.message ?? "The request could not be completed.";
    const details = result.error?.details?.join(" ");
    throw new Error(details ? `${message} ${details}` : message);
  }
  return result;
}

export default function App() {
  const [preview, setPreview] = useState<BillingPreview | null>(null);
  const [run, setRun] = useState<BillingRun | null>(null);
  const [loading, setLoading] = useState<"preview" | "run" | "invoice" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  async function loadPreview() {
    setLoading("preview");
    setError(null);
    try {
      const result = await postJson<{ data: BillingPreview }>(
        "/api/billing/preview",
      );
      setPreview(result.data);
      setRun(null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(null);
    }
  }

  async function runBilling() {
    setLoading("run");
    setError(null);
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const result = await postJson<{ data: BillingRun }>("/api/billing/run", {
        headers: { "Idempotency-Key": idempotencyKey.current },
      });
      setRun(result.data);
      idempotencyKey.current = null;
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(null);
    }
  }

  async function invoiceAction(
    invoiceId: string,
    action: "confirm" | "send" | "mark-paid",
  ) {
    setLoading("invoice");
    setError(null);
    try {
      await postJson(`/api/invoices/${invoiceId}/${action}`);
      setRun((current) =>
        current
          ? {
              ...current,
              created: current.created.map((invoice) =>
                invoice.id === invoiceId
                  ? {
                      ...invoice,
                      status:
                        action === "confirm"
                          ? "confirmed"
                          : action === "mark-paid"
                            ? "paid"
                            : invoice.status,
                    }
                  : invoice,
              ),
            }
          : current,
      );
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="billing-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Brightloop home">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <span>Brightloop</span>
        </a>
        <span className="environment-badge">
          <span className="status-dot" />
          Local workspace
        </span>
      </header>

      <section className="billing-content" aria-labelledby="billing-title">
        <div className="page-heading">
          <div>
            <p className="eyebrow">FINANCE WORKSPACE</p>
            <h1 id="billing-title">Billing</h1>
            <p className="description">
              Preview upcoming charges, review exceptions, and safely run
              subscription billing.
            </p>
          </div>
          <div className="actions">
            <button
              className="button button-secondary"
              onClick={loadPreview}
              disabled={loading !== null}
            >
              {loading === "preview" ? "Refreshing…" : "Preview billing"}
            </button>
            <button
              className="button button-primary"
              onClick={runBilling}
              disabled={loading !== null || !preview}
            >
              {loading === "run" ? "Running…" : "Run billing"}
            </button>
          </div>
        </div>

        <p className="permission-note">
          Billing preview and execution require an authenticated admin or staff
          session. Invoice actions are saved immediately.
        </p>

        {error && (
          <div className="alert" role="alert">
            <strong>Could not complete the request</strong>
            <span>{error}</span>
          </div>
        )}

        {!preview ? (
          <section className="empty-state">
            <div className="empty-icon" aria-hidden="true">
              $
            </div>
            <h2>Review before you bill</h2>
            <p>
              Preview calculates due invoices without changing subscriptions or
              discount usage.
            </p>
            <button
              className="button button-primary"
              onClick={loadPreview}
              disabled={loading !== null}
            >
              {loading === "preview"
                ? "Loading preview…"
                : "Load billing preview"}
            </button>
          </section>
        ) : (
          <>
            <section className="summary-grid" aria-label="Preview totals">
              <SummaryCard
                label="Due subscriptions"
                value={String(preview.candidates.length)}
              />
              <SummaryCard label="Subtotal" value={preview.totals.subtotal} />
              <SummaryCard label="Discounts" value={preview.totals.discount} />
              <SummaryCard label="Tax" value={preview.totals.tax} />
              <SummaryCard
                label="Projected total"
                value={preview.totals.total}
              />
            </section>

            <div className="section-heading">
              <div>
                <h2>Billing preview</h2>
                <p>As of {preview.asOf} · no data has been changed</p>
              </div>
              <span className="count-badge">
                {preview.skipped.length} skipped
              </span>
            </div>

            {preview.warnings.length > 0 && (
              <section className="warning-panel" aria-label="Margin warnings">
                <strong>
                  {preview.warnings.length} margin warning
                  {preview.warnings.length === 1 ? "" : "s"}
                </strong>
                {preview.warnings.map((warning, index) => (
                  <p
                    key={`${warning.subscriptionNumber}-${warning.productId}-${index}`}
                  >
                    {warning.subscriptionNumber}: {warning.description} would
                    net {warning.netAfterDiscount} below cost{" "}
                    {warning.costAmount}.
                  </p>
                ))}
              </section>
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Subscription</th>
                    <th>Result</th>
                    <th>Subtotal</th>
                    <th>Discount</th>
                    <th>Tax</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.candidates.map((candidate) => (
                    <tr key={candidate.subscriptionId}>
                      <td className="primary-cell">
                        {candidate.subscriptionNumber}
                      </td>
                      <td>
                        {candidate.invoice ? (
                          <span className="result-badge result-ready">
                            Ready
                          </span>
                        ) : (
                          <span className="result-badge result-skipped">
                            {candidate.skipped?.reason.replaceAll("_", " ")}
                          </span>
                        )}
                      </td>
                      <td>{candidate.invoice?.subtotal ?? "—"}</td>
                      <td>{candidate.invoice?.discountTotal ?? "—"}</td>
                      <td>{candidate.invoice?.taxTotal ?? "—"}</td>
                      <td className="primary-cell">
                        {candidate.invoice?.total ?? candidate.skipped?.details}
                      </td>
                    </tr>
                  ))}
                  {preview.candidates.length === 0 && (
                    <tr>
                      <td className="empty-row" colSpan={6}>
                        No subscriptions are due for billing.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {run && (
          <section className="run-results" aria-labelledby="run-title">
            <div className="section-heading">
              <div>
                <h2 id="run-title">Billing run complete</h2>
                <p>
                  {run.created.length} invoice
                  {run.created.length === 1 ? "" : "s"} created · total{" "}
                  {run.totals.total}
                </p>
              </div>
              <span className="result-badge result-ready">Saved</span>
            </div>
            {run.created.length === 0 ? (
              <p className="empty-row">No invoices were created.</p>
            ) : (
              <div className="invoice-list">
                {run.created.map((invoice) => (
                  <article className="invoice-row" key={invoice.id}>
                    <div className="invoice-info">
                      <strong>{invoice.number}</strong>
                      <span>
                        {invoice.subscriptionNumber} · {invoice.periodStart} to{" "}
                        {invoice.periodEnd}
                      </span>
                    </div>
                    <span className="invoice-total">
                      {invoice.total} {invoice.currencyCode}
                    </span>
                    <span className="result-badge result-ready">
                      {invoice.status}
                    </span>
                    <div className="invoice-actions">
                      {invoice.status === "draft" && (
                        <button
                          className="text-button"
                          disabled={loading !== null}
                          onClick={() => invoiceAction(invoice.id, "confirm")}
                        >
                          Confirm
                        </button>
                      )}
                      {invoice.status === "confirmed" && (
                        <>
                          <button
                            className="text-button"
                            disabled={loading !== null}
                            onClick={() => invoiceAction(invoice.id, "send")}
                          >
                            Send
                          </button>
                          <button
                            className="text-button"
                            disabled={loading !== null}
                            onClick={() =>
                              invoiceAction(invoice.id, "mark-paid")
                            }
                          >
                            Mark paid
                          </button>
                        </>
                      )}
                      <a
                        className="text-button"
                        href={`/api/invoices/${invoice.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        PDF
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </section>
      <footer className="footer-note">
        Runs are transactional and idempotent. Invoice emails stay in the local
        outbox until a mail worker is configured.
      </footer>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected request error.";
}
