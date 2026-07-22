export type EventType = 'state_change' | 'task_update' | 'agent_broadcast' | 'alert';

export interface MeshEvent {
  id: string;
  topic: string;
  senderAgent: string;
  payload: string;
  eventType: EventType;
  timestamp: string;
}

export type EventSubscriber = (event: MeshEvent) => void;

export class EventMeshEngine {
  private subscriptions: Map<string, Set<EventSubscriber>> = new Map();
  private eventBuffer: MeshEvent[] = [];

  public subscribe(topic: string, handler: EventSubscriber): () => void {
    const subs = this.subscriptions.get(topic) || new Set();
    subs.add(handler);
    this.subscriptions.set(topic, subs);

    return () => {
      subs.delete(handler);
    };
  }

  public publish(
    id: string,
    topic: string,
    senderAgent: string,
    payload: string,
    eventType: EventType = 'state_change'
  ): MeshEvent {
    const event: MeshEvent = {
      id,
      topic,
      senderAgent,
      payload,
      eventType,
      timestamp: new Date().toISOString(),
    };

    this.eventBuffer.push(event);

    const topicSubscribers = this.subscriptions.get(topic);
    if (topicSubscribers) {
      topicSubscribers.forEach(handler => handler(event));
    }

    const wildcardSubscribers = this.subscriptions.get('*');
    if (wildcardSubscribers) {
      wildcardSubscribers.forEach(handler => handler(event));
    }

    return event;
  }

  public getEventHistory(topic?: string): MeshEvent[] {
    if (!topic || topic === '*') {
      return [...this.eventBuffer];
    }
    return this.eventBuffer.filter(e => e.topic === topic);
  }

  public clearBuffer(): void {
    this.eventBuffer = [];
  }
}
