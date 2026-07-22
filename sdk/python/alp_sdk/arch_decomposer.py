from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

class MonolithAnalysis:
    def __init__(self, target_path: str, total_files: int, coupling_score: float, modules: Dict[str, List[str]]):
        self.target_path = target_path
        self.total_files = total_files
        self.coupling_score = coupling_score
        self.modules = modules

class MicroservicePlan:
    def __init__(
        self,
        plan_id: str,
        monolith_target: str,
        proposed_services: List[str],
        service_boundaries: Dict[str, List[str]],
        coupling_score: float,
        created_at: Optional[str] = None,
    ):
        self.id = plan_id
        self.monolith_target = monolith_target
        self.proposed_services = proposed_services
        self.service_boundaries = service_boundaries
        self.coupling_score = coupling_score
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()

class ArchDecomposerEngine:
    def analyze_monolith(self, target_path: str, file_paths: List[str]) -> MonolithAnalysis:
        modules: Dict[str, List[str]] = {
            "auth": [],
            "billing": [],
            "notifications": [],
            "core": [],
        }

        for f in file_paths:
            if "auth" in f or "user" in f or "token" in f:
                modules["auth"].append(f)
            elif "pay" in f or "stripe" in f or "billing" in f:
                modules["billing"].append(f)
            elif "email" in f or "push" in f or "notify" in f:
                modules["notifications"].append(f)
            else:
                modules["core"].append(f)

        non_core = len(modules["auth"]) + len(modules["billing"]) + len(modules["notifications"])
        score = max(0.1, min(0.95, round(1.0 - (non_core / max(1, len(file_paths))), 2)))

        return MonolithAnalysis(
            target_path=target_path,
            total_files=len(file_paths),
            coupling_score=score,
            modules=modules,
        )

    def decompose(self, analysis: MonolithAnalysis) -> MicroservicePlan:
        proposed: List[str] = []
        boundaries: Dict[str, List[str]] = {}

        for mod_name, files in analysis.modules.items():
            if len(files) > 0:
                svc_name = f"service-{mod_name}"
                proposed.append(svc_name)
                boundaries[svc_name] = files

        sanitized_id = "".join(c if c.isalnum() else "-" for c in analysis.target_path)

        return MicroservicePlan(
            plan_id=f"refactor-{sanitized_id}",
            monolith_target=analysis.target_path,
            proposed_services=proposed,
            service_boundaries=boundaries,
            coupling_score=analysis.coupling_score,
        )
