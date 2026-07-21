"""ALP Workflow Visualization (v10.2.0 — Python SDK parity, spec/10-versioning.md).

Mirrors ``parser/src/visualize.ts``: parse ``@workflow`` objects into a
structured form and render them as Mermaid, Graphviz DOT, or JSON so users can
see their execution plans (``alp visualize``).
"""

from typing import Any, Dict, List, Optional

from .models import AlpObject

DiagramFormat = str  # "mermaid" | "dot" | "json"


class WorkflowStep:
    def __init__(
        self,
        name: str,
        task: Optional[str] = None,
        agent: Optional[str] = None,
        condition: Optional[str] = None,
        parallel_group: Optional[str] = None,
        wait_for: Optional[str] = None,
        on_success: Optional[str] = None,
        on_failure: Optional[str] = None,
    ):
        self.name = name
        self.task = task
        self.agent = agent
        self.condition = condition
        self.parallel_group = parallel_group
        self.wait_for = wait_for
        self.on_success = on_success
        self.on_failure = on_failure

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "task": self.task,
            "agent": self.agent,
            "condition": self.condition,
            "parallel_group": self.parallel_group,
            "wait_for": self.wait_for,
            "on_success": self.on_success,
            "on_failure": self.on_failure,
        }


class ParsedWorkflow:
    def __init__(self, id: str, name: str, goal: Optional[str], steps: List[WorkflowStep]):
        self.id = id
        self.name = name
        self.goal = goal
        self.steps = steps

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "goal": self.goal,
            "steps": [s.to_dict() for s in self.steps],
        }


def read_workflow(obj: AlpObject) -> ParsedWorkflow:
    steps: List[WorkflowStep] = []
    raw_steps = obj.properties.get("steps")
    if isinstance(raw_steps, list):
        for s in raw_steps:
            if isinstance(s, dict):
                steps.append(
                    WorkflowStep(
                        name=str(s.get("name", "(unnamed)")),
                        task=s.get("task"),
                        agent=s.get("agent"),
                        condition=s.get("condition"),
                        parallel_group=s.get("parallel_group"),
                        wait_for=s.get("wait_for"),
                        on_success=s.get("on_success"),
                        on_failure=s.get("on_failure"),
                    )
                )
            elif isinstance(s, str):
                steps.append(WorkflowStep(name=s))
    return ParsedWorkflow(
        id=str(obj.id),
        name=str(obj.properties.get("name", obj.id)),
        goal=obj.properties.get("goal"),
        steps=steps,
    )


class WorkflowVisualizer:
    def parse_workflows(self, objects: List[AlpObject]) -> List[ParsedWorkflow]:
        return [read_workflow(o) for o in objects if o._type == "workflow"]

    def to_mermaid(self, workflows: List[ParsedWorkflow]) -> str:
        lines = ["flowchart TD"]
        for wf in workflows:
            lines.append(f'  subgraph {sanitize(wf.id)}["{escape_mermaid(wf.name)}"]')
            for i, step in enumerate(wf.steps):
                node_id = step_id(wf.id, i)
                label = step_label(step)
                shape = f"{{{label}}}" if step.parallel_group else f"[{label}]"
                lines.append(f"    {node_id}{shape}")
                if i > 0:
                    prev = step_id(wf.id, i - 1)
                    if step.wait_for:
                        lines.append(f"    {sanitize('grp_' + step.wait_for)} --> {node_id}")
                    else:
                        lines.append(f"    {prev} --> {node_id}")
            if wf.steps:
                lines.append(
                    f"    {step_id(wf.id, len(wf.steps) - 1)} --> {sanitize(wf.id)}_done([\"✅ Done\"])"
                )
            lines.append("  end")
        return "\n".join(lines)

    def to_dot(self, workflows: List[ParsedWorkflow]) -> str:
        lines = ["digraph ALP {", "  rankdir=TD;", "  node [shape=box];"]
        for wf in workflows:
            lines.append(f"  subgraph cluster_{sanitize(wf.id)} {{")
            lines.append(f'    label="{escape_dot(wf.name)}";')
            for i, step in enumerate(wf.steps):
                node_id = step_id(wf.id, i)
                lines.append(f'    {node_id} [label="{escape_dot(step_label(step))}"];')
                if i > 0:
                    prev = step_id(wf.id, i - 1)
                    if step.wait_for:
                        lines.append(f"    grp_{sanitize(step.wait_for)} -> {node_id};")
                    else:
                        lines.append(f"    {prev} -> {node_id};")
            lines.append("  }")
        lines.append("}")
        return "\n".join(lines)

    def to_json(self, workflows: List[ParsedWorkflow]) -> str:
        import json

        return json.dumps([w.to_dict() for w in workflows], indent=2)

    def generate(self, workflows: List[ParsedWorkflow], format: DiagramFormat) -> str:
        if format == "dot":
            return self.to_dot(workflows)
        if format == "json":
            return self.to_json(workflows)
        return self.to_mermaid(workflows)


def step_id(wf_id: str, index: int) -> str:
    return f"s_{sanitize(wf_id)}_{index}"


def step_label(step: WorkflowStep) -> str:
    parts = [step.name]
    if step.task:
        parts.append(f"task: {step.task.replace('->', '').strip()}")
    if step.agent:
        parts.append(f"agent: {step.agent.replace('->', '').strip()}")
    if step.condition:
        parts.append(f"if: {step.condition}")
    if step.parallel_group:
        parts.append(f"group: {step.parallel_group}")
    return "\\n".join(parts)


def sanitize(value: str) -> str:
    return "".join(c if c.isalnum() or c == "_" else "_" for c in value)


def escape_mermaid(value: str) -> str:
    return value.replace('"', "'").replace("[", "").replace("]", "")


def escape_dot(value: str) -> str:
    return value.replace('"', '\\"')
