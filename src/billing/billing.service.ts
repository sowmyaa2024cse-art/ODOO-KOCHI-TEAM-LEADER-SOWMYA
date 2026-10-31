import type { AuthActor } from "../auth/auth.types.js";
import { AppError } from "../errors/app-error.js";
import type { Clock } from "../services/clock.js";
import type { InvoiceAction } from "../invoices/invoice-state-machine.js";
import type {
  BillingRepository,
  BillingRunResult,
} from "./billing.repository.js";
import type { MarginGuardMode } from "./billing.calculator.js";
import { BillingEvents } from "./billing.events.js";
import type { createPaymentSchema } from "./report.schemas.js";
import type { z } from "zod";

export class BillingService {
  readonly events = new BillingEvents();

  constructor(
    private readonly repository: BillingRepository,
    private readonly clock: Clock,
    private readonly marginMode: MarginGuardMode,
  ) {}

  preview() {
    return this.repository.preview(this.clock.now(), this.marginMode);
  }

  run(actor: AuthActor, idempotencyKey: string): Promise<BillingRunResult> {
    if (actor.role === "customer") {
      throw new AppError(403, "FORBIDDEN", "Customers cannot run billing.");
    }
    return this.repository
      .run(actor, idempotencyKey, this.clock.now(), this.marginMode)
      .then((result) => {
        if (!result.meta.replayed) {
          for (const invoice of result.data.created) {
            this.events.publish({
              type: "invoice.created",
              invoiceId: String(invoice.id),
              invoiceNumber: String(invoice.number),
              customerId: String(invoice.customerId),
              status: String(invoice.status),
              occurredAt: this.clock.now().toISOString(),
            });
          }
        }
        return result;
      });
  }

  recordPayment(
    invoiceId: string,
    input: z.infer<typeof createPaymentSchema>,
    actor: AuthActor,
  ) {
    return this.repository
      .recordPayment(invoiceId, input, actor, this.clock.now())
      .then((result) => {
        const payment = result.payment as Record<string, unknown>;
        const invoice = result.invoice as Record<string, unknown>;
        this.events.publish({
          type: "payment.recorded",
          invoiceId: String(invoice.id),
          invoiceNumber: String(invoice.number),
          customerId: String(invoice.customerId),
          status: String(invoice.status),
          paymentId: String(payment.id),
          amount: String(payment.amount),
          occurredAt: this.clock.now().toISOString(),
        });
        this.events.publish({
          type: "invoice.status",
          invoiceId: String(invoice.id),
          invoiceNumber: String(invoice.number),
          customerId: String(invoice.customerId),
          status: String(invoice.status),
          occurredAt: this.clock.now().toISOString(),
        });
        return result;
      });
  }

  createProration(
    subscriptionId: string,
    lineId: string,
    quantity: string,
    idempotencyKey: string,
    actor: AuthActor,
  ) {
    return this.repository
      .createProration(
        subscriptionId,
        lineId,
        quantity,
        idempotencyKey,
        actor,
        this.clock.now(),
      )
      .then((invoice) => {
        if (!invoice.replayed) {
          this.events.publish({
            type: "invoice.created",
            invoiceId: String(invoice.id),
            invoiceNumber: String(invoice.number),
            customerId: String(invoice.customerId),
            status: String(invoice.status),
            occurredAt: this.clock.now().toISOString(),
          });
        }
        return invoice;
      });
  }

  transitionInvoice(id: string, action: InvoiceAction, actor: AuthActor) {
    if (actor.role === "customer") {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Customers cannot change invoice status.",
      );
    }
    return this.repository
      .transitionInvoice(id, action, actor, this.clock.now())
      .then((invoice) => {
        this.events.publish({
          type: "invoice.status",
          invoiceId: String(invoice.id),
          invoiceNumber: String(invoice.number),
          customerId: String(invoice.customerId),
          status: String(invoice.status),
          occurredAt: this.clock.now().toISOString(),
        });
        return invoice;
      });
  }

  sendInvoice(id: string, actor: AuthActor) {
    if (actor.role === "customer") {
      throw new AppError(403, "FORBIDDEN", "Customers cannot send invoices.");
    }
    return this.repository
      .sendInvoice(id, actor, this.clock.now())
      .then((invoice) => {
        this.events.publish({
          type: "invoice.sent",
          invoiceId: String(invoice.id),
          invoiceNumber: String(invoice.number),
          customerId: String(invoice.customerId),
          status: String(invoice.status),
          occurredAt: this.clock.now().toISOString(),
        });
        return invoice;
      });
  }

  subscribeEvents(listener: Parameters<BillingEvents["subscribe"]>[0]) {
    return this.events.subscribe(listener);
  }

  invoiceForPrint(id: string, actor: AuthActor) {
    return this.repository.invoiceForPrint(id, actor);
  }
}
