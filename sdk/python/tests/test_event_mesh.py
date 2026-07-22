import pytest
from alp_sdk.event_mesh import (
    EventMeshEngine,
    EventMeshConfig,
    MeshEvent,
)

class TestEventMeshConfig:
    def test_default_values(self):
        config = EventMeshConfig("e1", "tasks.update", "agent-x", "payload data")
        assert config.id == "e1"
        assert config.topic == "tasks.update"
        assert config.sender_agent == "agent-x"
        assert config.payload == "payload data"
        assert config.event_type == "state_change"

class TestEventMeshEngine:
    def test_publish_and_subscribe(self):
        engine = EventMeshEngine()
        received = []

        def handler(event: MeshEvent):
            received.append(event)

        engine.subscribe("agent.tasks", handler)
        event = engine.publish("e1", "agent.tasks", "agent-alpha", "Task 1 updated", "task_update")

        assert event.id == "e1"
        assert len(received) == 1
        assert received[0].topic == "agent.tasks"
        assert received[0].sender_agent == "agent-alpha"

    def test_wildcard_subscription(self):
        engine = EventMeshEngine()
        received = []

        def wildcard_handler(event: MeshEvent):
            received.append(event)

        engine.subscribe("*", wildcard_handler)
        engine.publish("e2", "system.alerts", "guard-agent", "High memory usage", "alert")

        assert len(received) == 1
        assert len(engine.get_event_history()) == 1

    def test_filter_history_by_topic(self):
        engine = EventMeshEngine()
        engine.publish("e1", "topic.a", "agent-1", "msg1")
        engine.publish("e2", "topic.b", "agent-2", "msg2")

        history_a = engine.get_event_history("topic.a")
        assert len(history_a) == 1
        assert history_a[0].id == "e1"
