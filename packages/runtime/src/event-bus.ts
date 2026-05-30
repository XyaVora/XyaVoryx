import type { EventHandler, XyaVoryxEvent } from "@xyavoryx/core";

export class EventBus {
  private readonly handlers = new Set<EventHandler>();
  private readonly events: XyaVoryxEvent[] = [];

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  emit(event: XyaVoryxEvent): void {
    this.events.push(event);
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  getEvents(): XyaVoryxEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
    this.handlers.clear();
  }
}