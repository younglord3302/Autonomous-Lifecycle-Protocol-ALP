import unittest
from alp_sdk.event_mesh import (
    EventMeshEngine,
    EventMeshConfig,
    MeshEvent,
)

class TestEventMeshConfig(unittest.TestCase):
    def test_default_values(self):
        config = EventMeshConfig("e1", "tasks.update", "agent-x", "payload data")
        self.assertEqual(config.id, "e1")
        self.assertEqual(config.topic, "tasks.update")
        self.assertEqual(config.sender_agent, "agent-x")
        self.assertEqual(config.payload, "payload data")
        self.assertEqual(config.event_type, "state_change")

class TestEventMeshEngine(unittest.TestCase):
    def test_publish_and_subscribe(self):
        engine = EventMeshEngine()
        received = []

        def handler(event: MeshEvent):
            received.append(event)

        engine.subscribe("agent.tasks", handler)
        event = engine.publish("e1", "agent.tasks", "agent-alpha", "Task 1 updated", "task_update")

        self.assertEqual(event.id, "e1")
        self.assertEqual(len(received), 1)
        self.assertEqual(received[0].topic, "agent.tasks")
        self.assertEqual(received[0].sender_agent, "agent-alpha")

    def test_wildcard_subscription(self):
        engine = EventMeshEngine()
        received = []

        def wildcard_handler(event: MeshEvent):
            received.append(event)

        engine.subscribe("*", wildcard_handler)
        engine.publish("e2", "system.alerts", "guard-agent", "High memory usage", "alert")

        self.assertEqual(len(received), 1)
        self.assertEqual(len(engine.get_event_history()), 1)

    def test_filter_history_by_topic(self):
        engine = EventMeshEngine()
        engine.publish("e1", "topic.a", "agent-1", "msg1")
        engine.publish("e2", "topic.b", "agent-2", "msg2")

        history_a = engine.get_event_history("topic.a")
        self.assertEqual(len(history_a), 1)
        self.assertEqual(history_a[0].id, "e1")
