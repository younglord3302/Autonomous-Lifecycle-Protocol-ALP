from dataclasses import dataclass
from typing import Dict, Any, List, Optional

@dataclass
class AlpObject:
    _type: str
    id: str
    properties: Dict[str, Any]
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'AlpObject':
        props = data.copy()
        obj_type = props.pop('_type', 'unknown')
        obj_id = data.get('id', 'unknown-id')
        return cls(_type=obj_type, id=obj_id, properties=props)
