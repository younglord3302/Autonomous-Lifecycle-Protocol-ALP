import os
import re
from typing import List, Dict, Any, Optional
from .models import AlpObject

class AlpReader:
    def __init__(self):
        pass

    def parse(self, content: str) -> List[AlpObject]:
        lines = content.split('\n')
        objects = []
        
        current_obj = None
        current_nested = None
        current_list = None
        
        for line_num, line in enumerate(lines):
            trimmed = line.strip()
            
            # Skip empty lines, comments, and markdown separators
            if not trimmed or trimmed.startswith('//') or trimmed == '---':
                continue
                
            indent = len(line) - len(line.lstrip())
            
            if indent == 0:
                # Directives
                if trimmed.startswith('!'):
                    continue
                    
                # New object block
                type_match = re.match(r'^@([a-zA-Z_][a-zA-Z0-9_-]*)$', trimmed)
                if type_match:
                    if current_obj:
                        objects.append(AlpObject.from_dict(current_obj))
                    current_obj = {'_type': type_match.group(1)}
                    current_nested = None
                    current_list = None
                    continue
                raise SyntaxError(f"Invalid block marker at line {line_num+1}: {trimmed}")
                
            if indent == 2 and current_obj is not None:
                # Nested blocks (e.g., @accept)
                nested_match = re.match(r'^@([a-z_]+)$', trimmed)
                if nested_match:
                    current_nested = nested_match.group(1)
                    current_obj[current_nested] = []
                    current_list = None
                    continue
                    
                # List properties (e.g., tasks:)
                list_match = re.match(r'^([a-z_]+):$', trimmed)
                if list_match:
                    current_list = list_match.group(1)
                    current_obj[current_list] = []
                    current_nested = None
                    continue
                    
                # Property assignments
                prop_match = re.match(r'^([a-zA-Z_!][a-zA-Z0-9_-]*):\s*(.*)$', trimmed)
                if prop_match:
                    key = prop_match.group(1)
                    val = prop_match.group(2)
                    
                    if key.startswith('!'):
                        key = key[1:].replace('-', '_')
                        
                    if val.startswith('"') and val.endswith('"'):
                        val = val[1:-1]
                        
                    current_obj[key] = val
                    current_nested = None
                    current_list = None
                    continue
                    
                raise SyntaxError(f"Invalid property format at line {line_num+1}: {trimmed}")
                
            if indent == 4 and current_obj is not None and (current_nested or current_list):
                if trimmed.startswith('- '):
                    val = trimmed[2:].strip()
                    if current_nested and isinstance(current_obj[current_nested], list):
                        current_obj[current_nested].append(val)
                    elif current_list and isinstance(current_obj[current_list], list):
                        current_obj[current_list].append(val)
                    continue
                    
                nested_prop_match = re.match(r'^([a-z_][a-z0-9_-]*):\s*(.*)$', trimmed)
                if nested_prop_match and current_list:
                    if isinstance(current_obj[current_list], list):
                        current_obj[current_list] = {}
                    
                    key = nested_prop_match.group(1)
                    val = nested_prop_match.group(2)
                    if val.startswith('"') and val.endswith('"'):
                        val = val[1:-1]
                        
                    try:
                        current_obj[current_list][key] = int(val)
                    except ValueError:
                        current_obj[current_list][key] = val
                    continue
                    
                raise SyntaxError(f"Invalid list item at line {line_num+1}: {trimmed}")

        if current_obj:
            objects.append(AlpObject.from_dict(current_obj))
            
        return objects

def load_workspace(dir_path: str) -> List[AlpObject]:
    alp_dir = os.path.join(dir_path, '.alp')
    if not os.path.exists(alp_dir):
        return []
        
    reader = AlpReader()
    all_objects = []
    
    for filename in os.listdir(alp_dir):
        if filename.endswith('.alp'):
            filepath = os.path.join(alp_dir, filename)
            if os.path.isfile(filepath):
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                    all_objects.extend(reader.parse(content))
                    
    return all_objects
