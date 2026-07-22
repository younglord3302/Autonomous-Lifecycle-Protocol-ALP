"""ALP Universal Protocol Bridge (v17.0.0 — V13 The Universal Era).

Adapts ALP objects to and from external protocol descriptions:

* OpenAPI 3.0  — REST API specs
* GraphQL SDL  — schema definitions
* gRPC proto   — protobuf service definitions
* AsyncAPI     — event-driven / message API specs

``ProtocolBridge`` is the single entrypoint; ``alp bridge export`` and
``alp bridge import`` are the planned CLI commands. Tests live in
``sdk/python/tests/test_bridge.py``.
"""
from __future__ import annotations


import json
import textwrap
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union


SUPPORTED_FORMATS = ["openapi", "graphql", "grpc", "asyncapi"]


class BridgeError(Exception):
    """Raised when a bridge conversion cannot be performed."""


@dataclass
class BridgeExportResult:
    format: str
    spec: Dict[str, Any]
    source_workflow_id: str
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "format": self.format,
            "spec": self.spec,
            "source_workflow_id": self.source_workflow_id,
            "warnings": self.warnings,
        }


@dataclass
class BridgeImportResult:
    format: str
    workflow: Dict[str, Any]
    source_spec: Dict[str, Any]
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "format": self.format,
            "workflow": self.workflow,
            "source_spec": self.source_spec,
            "warnings": self.warnings,
        }


class ProtocolBridge:
    """Bidirectional adapter between ALP objects and external API specs.

    Usage::

        bridge = ProtocolBridge()
        result = bridge.export_workflow(workflow, fmt="openapi")
        spec = result.to_dict()["spec"]

        result = bridge.import_spec(spec, fmt="openapi")
        workflow = result.to_dict()["workflow"]
    """

    def __init__(self):
        self._exporters = {
            "openapi": self._export_openapi,
            "graphql": self._export_graphql,
            "grpc": self._export_grpc,
            "asyncapi": self._export_asyncapi,
        }
        self._importers = {
            "openapi": self._import_openapi,
            "graphql": self._import_graphql,
            "grpc": self._import_grpc,
            "asyncapi": self._import_asyncapi,
        }

    def export_workflow(self, workflow: Dict[str, Any], fmt: str) -> BridgeExportResult:
        fmt = fmt.lower()
        if fmt not in self._exporters:
            raise BridgeError(f"Unsupported export format '{fmt}'. Supported: {SUPPORTED_FORMATS}")
        exporter = self._exporters[fmt]
        spec, warnings = exporter(workflow)
        return BridgeExportResult(format=fmt, spec=spec, source_workflow_id=workflow.get("id", "_unknown"), warnings=warnings)

    def import_spec(self, spec: Dict[str, Any], fmt: str) -> BridgeImportResult:
        fmt = fmt.lower()
        if fmt not in self._importers:
            raise BridgeError(f"Unsupported import format '{fmt}'. Supported: {SUPPORTED_FORMATS}")
        importer = self._importers[fmt]
        workflow, warnings = importer(spec)
        return BridgeImportResult(format=fmt, workflow=workflow, source_spec=spec, warnings=warnings)

    # ── OpenAPI 3.0 ─────────────────────────────────────────────────────────

    def _export_openapi(self, workflow: Dict[str, Any]) -> tuple[Dict[str, Any], List[str]]:
        warnings: List[str] = []
        wf_id = workflow.get("id", workflow.get("name", "_unknown"))
        paths: Dict[str, Any] = {}
        schemas: Dict[str, Any] = {}
        step_idx = 0

        for step in workflow.get("steps", []):
            step_name = str(step.get("name", step.get("id", f"step-{step_idx}")))
            path = f"/{step_name}"
            step_idx += 1
            request_body = {"content": {"application/json": {"schema": {"type": "object", "properties": {"input": {"type": "string"}}}}}}
            responses = {"200": {"description": "Success", "content": {"application/json": {"schema": {"type": "object"}}}}}
            paths[path] = {"post": {"operationId": f"{wf_id}.{step_name}", "requestBody": request_body, "responses": responses}}
            schema_name = f"{wf_id}.{step_name}.Request"
            schemas[schema_name] = {"type": "object", "properties": {"input": {"type": "string"}}, "required": ["input"]}

        if not paths:
            warnings.append("Workflow has no steps; OpenAPI spec will be empty.")

        spec = {
            "openapi": "3.0.0",
            "info": {"title": f"ALP Workflow: {wf_id}", "version": "1.0.0"},
            "paths": paths,
            "components": {"schemas": schemas},
        }
        return spec, warnings

    def _import_openapi(self, spec: Dict[str, Any]) -> tuple[Dict[str, Any], List[str]]:
        warnings: List[str] = []
        info = spec.get("info", {})
        title = info.get("title", "imported-workflow")
        wf_id = title.replace(" ", "-").lower()
        steps: List[Dict[str, Any]] = []
        for path, methods in spec.get("paths", {}).items():
            for method, details in methods.items():
                if not isinstance(details, dict):
                    continue
                op_id = details.get("operationId", path.strip("/"))
                steps.append({"id": op_id, "name": op_id, "type": "step"})
                break
        workflow = {
            "id": wf_id,
            "name": title,
            "source_format": "openapi",
            "steps": steps,
        }
        if not steps:
            warnings.append("No paths found in OpenAPI spec.")
        return workflow, warnings

    # ── GraphQL SDL ─────────────────────────────────────────────────────────

    def _export_graphql(self, workflow: Dict[str, Any]) -> tuple[str, List[str]]:
        warnings: List[str] = []
        wf_id = workflow.get("id", workflow.get("name", "_unknown")).replace("-", "_")
        type_name = f"{wf_id}Workflow"
        lines = [f"type {type_name} {{"]
        for step in workflow.get("steps", []):
            name = str(step.get("name", step.get("id", "step"))).replace("-", "_")
            lines.append(f"  {name}: String")
        lines.append("}")
        lines.append("")
        lines.append(f"type Query {{")
        lines.append(f"  {wf_id}: {type_name}")
        lines.append("}")
        sdl = "\n".join(lines)
        return sdl, warnings

    def _import_graphql(self, spec: Union[str, Dict[str, Any]]) -> tuple[Dict[str, Any], List[str]]:
        warnings: List[str] = []
        if isinstance(spec, dict):
            sdl = json.dumps(spec)
        else:
            sdl = str(spec)
        steps: List[Dict[str, Any]] = []
        for line in sdl.splitlines():
            line = line.strip()
            if not line or line.startswith("type ") or line.startswith("}"):
                continue
            if ": " in line and not line.startswith("#"):
                field_name = line.split(":")[0].strip().strip("{")
                if field_name:
                    steps.append({"id": field_name, "name": field_name, "type": "step"})
        workflow = {
            "id": "imported-graphql-workflow",
            "name": "Imported GraphQL Workflow",
            "source_format": "graphql",
            "steps": steps,
        }
        if not steps:
            warnings.append("No fields found in GraphQL SDL.")
        return workflow, warnings

    # ── gRPC proto ──────────────────────────────────────────────────────────

    def _export_grpc(self, workflow: Dict[str, Any]) -> tuple[str, List[str]]:
        warnings: List[str] = []
        wf_id = workflow.get("id", workflow.get("name", "_unknown")).replace("-", "_")
        service_name = f"{wf_id}Service"
        lines = [f'syntax = "proto3";', "", f"package alp;", "", f"service {service_name} {{"]
        for step in workflow.get("steps", []):
            name = str(step.get("name", step.get("id", "step"))).replace("-", "_")
            lines.append(f"  rpc {name}({name}Request) returns ({name}Response);")
        lines.append("}")
        lines.append("")
        for step in workflow.get("steps", []):
            name = str(step.get("name", step.get("id", "step"))).replace("-", "_")
            lines.append(f"message {name}Request {{")
            lines.append(f"  string input = 1;")
            lines.append(f"}}")
            lines.append(f"message {name}Response {{")
            lines.append(f"  string output = 1;")
            lines.append(f"}}")
            lines.append("")
        proto = "\n".join(lines)
        return proto, warnings

    def _import_grpc(self, spec: Union[str, Dict[str, Any]]) -> tuple[Dict[str, Any], List[str]]:
        warnings: List[str] = []
        if isinstance(spec, dict):
            proto = json.dumps(spec)
        else:
            proto = str(spec)
        steps: List[Dict[str, Any]] = []
        for line in proto.splitlines():
            line = line.strip()
            if line.startswith("rpc ") and "(" in line:
                rpc_name = line.split("(")[0].replace("rpc ", "").strip()
                if rpc_name:
                    steps.append({"id": rpc_name, "name": rpc_name, "type": "step"})
        workflow = {
            "id": "imported-grpc-workflow",
            "name": "Imported gRPC Workflow",
            "source_format": "grpc",
            "steps": steps,
        }
        if not steps:
            warnings.append("No RPC methods found in proto spec.")
        return workflow, warnings

    # ── AsyncAPI ────────────────────────────────────────────────────────────

    def _export_asyncapi(self, workflow: Dict[str, Any]) -> tuple[Dict[str, Any], List[str]]:
        warnings: List[str] = []
        wf_id = workflow.get("id", workflow.get("name", "_unknown"))
        channels: Dict[str, Any] = {}
        for step in workflow.get("steps", []):
            name = str(step.get("name", step.get("id", "step")))
            channel_name = f"{wf_id}/{name}"
            channels[channel_name] = {
                "publish": {"message": {"name": f"{name}Request", "payload": {"type": "object", "properties": {"input": {"type": "string"}}}}},
                "subscribe": {"message": {"name": f"{name}Response", "payload": {"type": "object", "properties": {"output": {"type": "string"}}}}},
            }
        spec = {
            "asyncapi": "2.0.0",
            "info": {"title": f"ALP Workflow: {wf_id}", "version": "1.0.0"},
            "channels": channels,
        }
        if not channels:
            warnings.append("Workflow has no steps; AsyncAPI spec will be empty.")
        return spec, warnings

    def _import_asyncapi(self, spec: Dict[str, Any]) -> tuple[Dict[str, Any], List[str]]:
        warnings: List[str] = []
        info = spec.get("info", {})
        title = info.get("title", "imported-asyncapi-workflow")
        wf_id = title.replace(" ", "-").lower()
        steps: List[Dict[str, Any]] = []
        for channel in spec.get("channels", {}).values():
            if isinstance(channel, dict):
                pub = channel.get("publish", {})
                msg = pub.get("message", {})
                name = msg.get("name", "step")
                steps.append({"id": name, "name": name, "type": "step"})
        workflow = {
            "id": wf_id,
            "name": title,
            "source_format": "asyncapi",
            "steps": steps,
        }
        if not steps:
            warnings.append("No channels found in AsyncAPI spec.")
        return workflow, warnings
