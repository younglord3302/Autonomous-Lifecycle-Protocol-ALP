import hashlib
import hmac
import os
from datetime import datetime, timezone
from typing import Dict, Any, Optional

class ZKProof:
    def __init__(
        self,
        proof_id: str,
        statement: str,
        commitment: str,
        proof_hash: str,
        verified: bool = True,
        created_at: Optional[str] = None,
    ):
        self.id = proof_id
        self.statement = statement
        self.commitment = commitment
        self.proof_hash = proof_hash
        self.verified = verified
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()

class ZKProofEngine:
    def generate_proof(self, proof_id: str, statement: str, secret_value: str) -> ZKProof:
        salt = os.urandom(16).hex()
        commitment = hmac.new(salt.encode("utf-8"), secret_value.encode("utf-8"), hashlib.sha256).hexdigest()
        
        raw = f"{statement}:{commitment}:{salt}"
        proof_hash_val = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        combined_proof_hash = f"{salt}:{proof_hash_val}"

        return ZKProof(
            proof_id=proof_id,
            statement=statement,
            commitment=commitment,
            proof_hash=combined_proof_hash,
            verified=True,
        )

    def verify_proof(self, proof: ZKProof) -> bool:
        if not proof or not proof.proof_hash or not proof.commitment:
            return False

        parts = proof.proof_hash.split(":")
        if len(parts) != 2:
            return False

        salt, expected_hash = parts
        raw = f"{proof.statement}:{proof.commitment}:{salt}"
        computed_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()

        return computed_hash == expected_hash
