from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Callable, Set

class MeshEvent:
    __test__ = False

    def __init__(
        self,
        event_id: str,
        topic: str,
        sender_agent: str,
        payload: str,
        event_type: str = "state_change",
        timestamp: Optional[str] = None,
    ):
        self.id = event_id
        self.topic = topic
        self.sender_agent = sender_agent
        self.payload = payload
        self.event_type = event_type
        self.timestamp = timestamp or datetime.now(timezone.utc).isoformat()

class EventMeshConfig:
    __test__ = False

    def __init__(
        self,
        event_id: str,
        topic: str,
        sender_agent: str,
        payload: str,
        event_type: str = "state_change",
        timestamp: Optional[str] = None,
        description: Optional[str] = None,
    ):
        self.id = event_id
        self.topic = topic
        self.sender_agent = sender_agent
        self.payload = payload
        self.event_type = event_type
        self.timestamp = timestamp or datetime.now(timezone.utc).isoformat()
        self.description = description

class EventMeshEngine:
    def __init__(self):
        self.subscriptions: Dict[str, Set[Callable[[MeshEvent], None]]] = {}
        self.event_buffer: List[MeshEvent] = []

    def subscribe(self, topic: str, handler: Callable[[MeshEvent], None]) -> Callable[[], None]:
        subs = self.subscriptions.get(topic, set())
        subs.add(handler)
        self.subscriptions[topic] = subs

        def unsubscribe():
            if topic in self.subscriptions and handler in self.subscriptions[topic]:
                self.subscriptions[topic].remove(handler)

        return unsubscribe

    def publish(
        self,
        event_id: str,
        topic: str,
        sender_agent: str,
        payload: str,
        event_type: str = "state_change",
    ) -> MeshEvent:
        event = MeshEvent(
            event_id=event_id,
            topic=topic,
            sender_agent=sender_agent,
            payload=payload,
            event_type=event_type,
        )
        self.event_buffer.append(event)

        topic_subs = self.subscriptions.get(topic, set())
        for handler in list(topic_subs):
            handler(event)

        wildcard_subs = self.subscriptions.get("*", set())
        for handler in list(wildcard_subs):
            handler(event)

        return event

    def get_event_history(self, topic: Optional[str] = None) -> List[MeshEvent]:
        if not topic or topic == "*":
            return list(self.event_buffer)
        return [e for e in self.event_buffer if e.topic == topic]

    def clear_buffer(self) -> None:
        self.event_buffer.clear()
