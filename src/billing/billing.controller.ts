import type { RequestHandler, Response } from "express";
import type { AuthActor } from "../auth/auth.types.js";
import type { InvoiceAction } from "../invoices/invoice-state-machine.js";
import { renderInvoicePdf } from "../invoices/invoice.pdf.js";
import type { BillingService } from "./billing.service.js";

function validated<T>(response: Response, target: string): T {
  const data = response.locals.validated as Record<string, unknown> | undefined;
  return data?.[target] as T;
}

function actor(response: Response): AuthActor {
  return response.locals.authActor as AuthActor;
}

export function createBillingController(service: BillingService) {
  const preview: RequestHandler = async (_request, response, next) => {
    try {
      const data = await service.preview();
      response.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };
  const run: RequestHandler = async (_request, response, next) => {
    try {
      const result = await service.run(
        actor(response),
        validated<string>(response, "idempotency-key"),
      );
      response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
  const proration: RequestHandler = async (_request, response, next) => {
    try {
      const { id, lineId } = validated<{ id: string; lineId: string }>(
        response,
        "params",
      );
      const { quantity } = validated<{ quantity: string }>(response, "body");
      const data = await service.createProration(
        id,
        lineId,
        quantity,
        validated<string>(response, "idempotency-key"),
        actor(response),
      );
      response.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  };
  const transition =
    (action: InvoiceAction): RequestHandler =>
    async (_request, response, next) => {
      try {
        const { id } = validated<{ id: string }>(response, "params");
        const data = await service.transitionInvoice(
          id,
          action,
          actor(response),
        );
        response.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    };
  const send: RequestHandler = async (_request, response, next) => {
    try {
      const { id } = validated<{ id: string }>(response, "params");
      const data = await service.sendInvoice(id, actor(response));
      response.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  };
  const pdf: RequestHandler = async (_request, response, next) => {
    try {
      const { id } = validated<{ id: string }>(response, "params");
      const invoice = await service.invoiceForPrint(id, actor(response));
      response
        .status(200)
        .type("application/pdf")
        .attachment(`${String(invoice.number)}.pdf`)
        .send(renderInvoicePdf(invoice));
    } catch (error) {
      next(error);
    }
  };
  const payment: RequestHandler = async (_request, response, next) => {
    try {
      const { id } = validated<{ id: string }>(response, "params");
      const data = await service.recordPayment(
        id,
        validated<{
          method: "cash" | "bank_transfer" | "card" | "cheque" | "other";
          amount: string;
          receivedAt: string;
          note?: string;
        }>(response, "body"),
        actor(response),
      );
      response.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  };
  const events: RequestHandler = (_request, response) => {
    const authenticatedActor = actor(response);
    response.status(200);
    response.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    response.write("event: ready\ndata: {}\n\n");

    const unsubscribe = service.subscribeEvents((event) => {
      if (
        authenticatedActor.role === "customer" &&
        event.customerId !== authenticatedActor.customerId
      ) {
        return;
      }
      response.write(
        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    });
    const heartbeat = setInterval(() => {
      response.write(": keep-alive\n\n");
    }, 25_000);
    response.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  };

  return {
    preview,
    run,
    proration,
    confirm: transition("confirm"),
    markPaid: transition("mark_paid"),
    cancel: transition("cancel"),
    send,
    pdf,
    payment,
    events,
  };
}
