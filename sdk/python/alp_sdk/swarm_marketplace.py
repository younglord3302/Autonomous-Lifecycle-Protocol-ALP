from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Callable

class SkillListing:
    __test__ = False

    def __init__(
        self,
        listing_id: str,
        provider_agent: str,
        skill_name: str,
        category: str,
        cost_per_call: float = 0.01,
        rating: float = 5.0,
        total_invocations: int = 0,
        description: Optional[str] = None,
        registered_at: Optional[str] = None,
    ):
        self.id = listing_id
        self.provider_agent = provider_agent
        self.skill_name = skill_name
        self.category = category
        self.cost_per_call = cost_per_call
        self.rating = rating
        self.total_invocations = total_invocations
        self.description = description
        self.registered_at = registered_at or datetime.now(timezone.utc).isoformat()

class SkillInvocationResult:
    __test__ = False

    def __init__(
        self,
        listing_id: str,
        caller_agent: str,
        provider_agent: str,
        skill_name: str,
        input_data: str,
        output: str,
        cost_charged: float,
        latency_ms: float,
        invoked_at: Optional[str] = None,
    ):
        self.listing_id = listing_id
        self.caller_agent = caller_agent
        self.provider_agent = provider_agent
        self.skill_name = skill_name
        self.input_data = input_data
        self.output = output
        self.cost_charged = cost_charged
        self.latency_ms = latency_ms
        self.invoked_at = invoked_at or datetime.now(timezone.utc).isoformat()

class SwarmMarketplaceEngine:
    def __init__(self):
        self.listings: Dict[str, SkillListing] = {}
        self.invocation_log: List[SkillInvocationResult] = []

    def register_skill(
        self,
        listing_id: str,
        provider_agent: str,
        skill_name: str,
        category: str,
        cost_per_call: float = 0.01,
        description: Optional[str] = None,
    ) -> SkillListing:
        listing = SkillListing(
            listing_id=listing_id,
            provider_agent=provider_agent,
            skill_name=skill_name,
            category=category,
            cost_per_call=cost_per_call,
            description=description,
        )
        self.listings[listing_id] = listing
        return listing

    def discover_skills(self, category: Optional[str] = None) -> List[SkillListing]:
        all_listings = list(self.listings.values())
        if not category:
            return all_listings
        return [l for l in all_listings if l.category == category]

    def invoke_skill(
        self,
        listing_id: str,
        caller_agent: str,
        input_data: str,
        executor: Optional[Callable[[str, str], Dict[str, Any]]] = None,
    ) -> Optional[SkillInvocationResult]:
        listing = self.listings.get(listing_id)
        if not listing:
            return None

        def default_executor(skill_name: str, inp: str) -> Dict[str, Any]:
            return {"output": f"[{skill_name}] Processed: \"{inp}\"", "latency_ms": 85.0}

        exec_fn = executor or default_executor
        res = exec_fn(listing.skill_name, input_data)

        listing.total_invocations += 1

        result = SkillInvocationResult(
            listing_id=listing_id,
            caller_agent=caller_agent,
            provider_agent=listing.provider_agent,
            skill_name=listing.skill_name,
            input_data=input_data,
            output=res.get("output", ""),
            cost_charged=listing.cost_per_call,
            latency_ms=res.get("latency_ms", 85.0),
        )
        self.invocation_log.append(result)
        return result

    def rate_skill(self, listing_id: str, new_rating: float) -> bool:
        listing = self.listings.get(listing_id)
        if not listing:
            return False
        listing.rating = min(5.0, max(0.0, round((listing.rating + new_rating) / 2, 2)))
        return True

    def get_invocation_log(self) -> List[SkillInvocationResult]:
        return list(self.invocation_log)

    def get_listing(self, listing_id: str) -> Optional[SkillListing]:
        return self.listings.get(listing_id)
