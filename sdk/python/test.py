from alp_sdk import load_workspace, validate_object

workspace_dir = '../../examples/todo-app'
print(f"Loading workspace from {workspace_dir}...")
objects = load_workspace(workspace_dir)
print(f"Loaded {len(objects)} objects.")

success_count = 0
error_count = 0

for obj in objects:
    try:
        validate_object(obj._type, obj.properties)
        success_count += 1
    except Exception as e:
        print(f"Error: {e}")
        error_count += 1

print(f"Validation complete: {success_count} success, {error_count} errors.")
