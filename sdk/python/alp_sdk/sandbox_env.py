import time
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

class SandboxInstance:
    def __init__(
        self,
        sandbox_id: str,
        engine_type: str = "wasm",
        memory_mb: int = 128,
        read_only_fs: bool = True,
        allowed_commands: Optional[List[str]] = None,
        created_at: Optional[str] = None,
    ):
        self.id = sandbox_id
        self.engine_type = engine_type
        self.memory_mb = memory_mb
        self.read_only_fs = read_only_fs
        self.allowed_commands = allowed_commands or ["npm test", "node index.js", "python main.py"]
        self.status = "READY"
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()

class SandboxExecutionResult:
    def __init__(
        self,
        sandbox_id: str,
        command: str,
        exit_code: int,
        stdout: str,
        stderr: str,
        execution_time_ms: float,
        isolated: bool = True,
    ):
        self.sandbox_id = sandbox_id
        self.command = command
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr
        self.execution_time_ms = execution_time_ms
        self.isolated = isolated

class SandboxEnvEngine:
    def __init__(self):
        self.sandboxes: Dict[str, SandboxInstance] = {}

    def create_sandbox(
        self,
        sandbox_id: str,
        engine_type: str = "wasm",
        memory_mb: int = 128,
        read_only_fs: bool = True,
        allowed_commands: Optional[List[str]] = None,
    ) -> SandboxInstance:
        instance = SandboxInstance(
            sandbox_id=sandbox_id,
            engine_type=engine_type,
            memory_mb=memory_mb,
            read_only_fs=read_only_fs,
            allowed_commands=allowed_commands,
        )
        self.sandboxes[sandbox_id] = instance
        return instance

    def execute_in_sandbox(self, sandbox_id: str, command: str) -> SandboxExecutionResult:
        start = time.time()
        instance = self.sandboxes.get(sandbox_id)

        if not instance:
            return SandboxExecutionResult(
                sandbox_id=sandbox_id,
                command=command,
                exit_code=1,
                stdout="",
                stderr=f"Error: Sandbox environment '{sandbox_id}' not found.",
                execution_time_ms=0.0,
                isolated=False,
            )

        cmd_root = command.split()[0]
        is_allowed = any(cmd.startswith(cmd_root) for cmd in instance.allowed_commands)

        if not is_allowed:
            return SandboxExecutionResult(
                sandbox_id=sandbox_id,
                command=command,
                exit_code=126,
                stdout="",
                stderr=f"Permission Denied: Command '{command}' not in sandbox allowed_commands whitelist.",
                execution_time_ms=(time.time() - start) * 1000,
                isolated=True,
            )

        return SandboxExecutionResult(
            sandbox_id=sandbox_id,
            command=command,
            exit_code=0,
            stdout=f"[Wasm Sandbox Exec: {instance.engine_type}] {command} executed cleanly",
            stderr="",
            execution_time_ms=(time.time() - start) * 1000 + 5.0,
            isolated=True,
        )

    def verify_sandbox_isolation(self, result: SandboxExecutionResult) -> bool:
        return result.isolated and (result.exit_code == 0 or "Permission Denied" in result.stderr)
