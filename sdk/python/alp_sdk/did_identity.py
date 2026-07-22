import hashlib
import os
import secrets
from datetime import datetime, timezone
from typing import Dict, Any, Optional

class DIDDocument:
    def __init__(
        self,
        doc_id: str,
        did_uri: str,
        public_key: str,
        chain_id: str = "alp-mainnet-1",
        anchor_block_hash: Optional[str] = None,
        created_at: Optional[str] = None,
    ):
        self.id = doc_id
        self.did_uri = did_uri
        self.public_key = public_key
        self.chain_id = chain_id
        self.anchor_block_hash = anchor_block_hash
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()

class DIDAnchorReceipt:
    def __init__(
        self,
        did_uri: str,
        block_hash: str,
        transaction_hash: str,
        anchored_at: Optional[str] = None,
        status: str = "CONFIRMED",
    ):
        self.did_uri = did_uri
        self.block_hash = block_hash
        self.transaction_hash = transaction_hash
        self.anchored_at = anchored_at or datetime.now(timezone.utc).isoformat()
        self.status = status

class DIDIdentityEngine:
    def create_did(self, agent_id: str, chain_id: str = "alp-mainnet-1") -> DIDDocument:
        # Generate dummy Ed25519-like key material for Python SDK demo
        raw_key = secrets.token_hex(32)
        public_key_pem = f"-----BEGIN PUBLIC KEY-----\n{raw_key}\n-----END PUBLIC KEY-----"
        
        key_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()[:32]
        did_uri = f"did:alp:{chain_id}:{key_hash}"

        return DIDDocument(
            doc_id=f"did-{agent_id}",
            did_uri=did_uri,
            public_key=public_key_pem,
            chain_id=chain_id,
        )

    def anchor_to_ledger(self, did_doc: DIDDocument, block_hash: Optional[str] = None) -> DIDAnchorReceipt:
        b_hash = block_hash or secrets.token_hex(32)
        tx_hash = hashlib.sha256(f"{did_doc.did_uri}:{b_hash}".encode("utf-8")).hexdigest()

        did_doc.anchor_block_hash = b_hash

        return DIDAnchorReceipt(
            did_uri=did_doc.did_uri,
            block_hash=b_hash,
            transaction_hash=tx_hash,
            status="CONFIRMED",
        )

    def verify_did_anchor(self, did_doc: DIDDocument) -> bool:
        if not did_doc or not did_doc.did_uri or not did_doc.public_key:
            return False
        return did_doc.did_uri.startswith(f"did:alp:{did_doc.chain_id}:") and bool(did_doc.anchor_block_hash)
