import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../packages/runtime/src/event-bus";

describe("EventBus", () => {
  it("emits events to subscribers", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe(handler);

    bus.emit({
      id: "event-1",
      type: "agent.started",
      timestamp: "2026-01-01T00:00:00.000Z"
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(bus.getEvents()).toHaveLength(1);
  });

  it("unsubscribes handlers", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe(handler);

    unsubscribe();
    bus.emit({
      id: "event-2",
      type: "agent.started",
      timestamp: "2026-01-01T00:00:00.000Z"
    });

    expect(handler).not.toHaveBeenCalled();
  });
});