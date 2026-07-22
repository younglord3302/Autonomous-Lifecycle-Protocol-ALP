from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timezone
from typing import Union, Optional

class AssetBundle:
    def __init__(
        self,
        asset_id: str,
        asset_type: str,
        mime_type: str,
        digest: str,
        size_bytes: int,
        data_base64: str,
        created_at: Optional[str] = None,
    ):
        self.id = asset_id
        self.asset_type = asset_type
        self.mime_type = mime_type
        self.digest = digest
        self.size_bytes = size_bytes
        self.data_base64 = data_base64
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()

class AssetContextEngine:
    def bundle_asset(
        self,
        asset_id: str,
        asset_type: str,
        mime_type: str,
        content: Union[str, bytes],
    ) -> AssetBundle:
        raw_bytes = content.encode("utf-8") if isinstance(content, str) else content
        digest = hashlib.sha256(raw_bytes).hexdigest()
        data_base64 = base64.b64encode(raw_bytes).decode("utf-8")

        return AssetBundle(
            asset_id=asset_id,
            asset_type=asset_type,
            mime_type=mime_type,
            digest=digest,
            size_bytes=len(raw_bytes),
            data_base64=data_base64,
        )

    def encode_context_prompt(self, bundle: AssetBundle) -> str:
        return f"""[ALP Multi-Modal Asset Context: @{bundle.id}]
Type: {bundle.asset_type}
MIME: {bundle.mime_type}
Digest: sha256:{bundle.digest[:16]}...
Data: data:{bundle.mime_type};base64,{bundle.data_base64[:32]}...
[End Asset Context]"""

    def verify_asset_integrity(self, bundle: AssetBundle) -> bool:
        if not bundle or not bundle.data_base64 or not bundle.digest:
            return False
        raw_bytes = base64.b64decode(bundle.data_base64)
        computed_digest = hashlib.sha256(raw_bytes).hexdigest()
        return computed_digest == bundle.digest
