import os
import json
from jsonschema import validate, ValidationError as JsonSchemaError
# pyrefly: ignore [missing-import]
from referencing import Registry, Resource
from typing import Dict, Any

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
