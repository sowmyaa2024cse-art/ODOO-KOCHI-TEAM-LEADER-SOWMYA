import { EventEmitter } from "node:events";

export interface BillingEvent {
  type:
    "invoice.created" | "invoice.status" | "invoice.sent" | "payment.recorded";
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  status: string;
  paymentId?: string;
  amount?: string;
  occurredAt: string;
}

export class BillingEvents {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: BillingEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: BillingEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
