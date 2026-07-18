import os
import json
import subprocess
from jsonschema import validate, ValidationError as JsonSchemaError
# pyrefly: ignore [missing-import]
from referencing import Registry, Resource
from typing import Dict, Any, List

_schemas: Dict[str, Any] = {}
_registry: Registry = None

def load_schemas():
    if _schemas:
        return
        
    # Find the schemas directory relative to the sdk
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    schemas_dir = os.path.join(base_dir, 'schemas')
    
    if not os.path.exists(schemas_dir):
        raise FileNotFoundError(f"Could not find schemas directory at {schemas_dir}")
        
    for filename in os.listdir(schemas_dir):
        if filename.endswith('.schema.json'):
            schema_name = filename.replace('.schema.json', '')
            with open(os.path.join(schemas_dir, filename), 'r', encoding='utf-8') as f:
                schema = json.load(f)
                _schemas[schema_name] = schema
                
    # Build a referencing registry for $ref resolution
    global _registry
    resources = []
    for name, schema in _schemas.items():
        resources.append((f"{name}.schema.json", Resource.from_contents(schema)))
    _registry = Registry().with_resources(resources)

def validate_object(obj_type: str, properties: Dict[str, Any]) -> bool:
    load_schemas()
    
    if obj_type not in _schemas:
        raise ValueError(f"Unknown object type: @{obj_type}")
        
    try:
        validate(instance=properties, schema=_schemas[obj_type], registry=_registry)
        return True
    except JsonSchemaError as e:
        raise ValueError(f"Validation failed for @{obj_type} '{properties.get('id', 'unknown')}': {e.message}")


def verify_workspace(dir_path: str, cwd: str = None) -> Dict[str, Any]:
    """Run every task's ``verify`` quality gates in a workspace.

    Mirrors the ``alp verify <taskId>`` CLI command, but operates on the whole
    workspace at once and is non-mutating (it does not rewrite status back to
    the ``.alp`` files). Each task's ``verify`` entries are executed as shell
    commands via ``subprocess``; a task passes only when every gate exits 0.

    Returns a report dict::

        {
          "passed": bool,
          "tasks": [
            {"id": str, "verified": bool, "gates": int,
             "failed_gate": Optional[int], "error": Optional[str]}
          ]
        }
    """
    from .reader import load_workspace

    objects = load_workspace(dir_path)
    tasks = [o for o in objects if o._type == "task"]

    results: List[Dict[str, Any]] = []
    all_passed = True

    for task in tasks:
        task_id = task.properties.get("id", "<unknown>")
        gates = task.properties.get("verify")
        if not gates or not isinstance(gates, list) or len(gates) == 0:
            results.append({
                "id": task_id,
                "verified": True,
                "gates": 0,
                "failed_gate": None,
                "error": None,
            })
            continue

        verified = True
        failed_gate = None
        error = None
        for idx, cmd in enumerate(gates, start=1):
            try:
                subprocess.run(cmd, shell=True, check=True, cwd=cwd,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            except subprocess.CalledProcessError as e:
                verified = False
                failed_gate = idx
                error = (e.stderr or b"").decode("utf-8", "replace").strip() or \
                    (e.stdout or b"").decode("utf-8", "replace").strip() or \
                    f"command exited with code {e.returncode}"
                break
            except Exception as e:  # pragma: no cover - defensive
                verified = False
                failed_gate = idx
                error = str(e)
                break

        if not verified:
            all_passed = False
        results.append({
            "id": task_id,
            "verified": verified,
            "gates": len(gates),
            "failed_gate": failed_gate,
            "error": error,
        })

    return {"passed": all_passed, "tasks": results}
