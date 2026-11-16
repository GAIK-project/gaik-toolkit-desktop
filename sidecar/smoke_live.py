"""Live smoke test of the engine. Makes real model calls: needs provider keys in the
environment (LLM_PROVIDER plus that provider's variables).

    python sidecar/smoke_live.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("GAIK_DESKTOP_TOKEN", "smoke")
sys.path.insert(0, str(Path(__file__).parent))

import pymupdf as fitz  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402

client = TestClient(server.app, raise_server_exceptions=False)
AUTH = {"Authorization": "Bearer smoke"}
INVOICE = """INVOICE
Invoice number: INV-2041
Invoice date: 12.03.2026
Vendor: Northwind Tools Oy
Customer: Example Builders Ltd
Total due: 1 240,50 EUR
"""


def call(method: str, url: str, **json):
    response = client.request(method, url, headers=AUTH, json=json or None)
    body = response.json()
    if response.status_code != 200:
        raise SystemExit(f"FAIL {url}: {response.status_code} {body}")
    return body


def main() -> None:
    assert client.get("/health").status_code == 401, (
        "a request without the token must be refused"
    )

    with tempfile.TemporaryDirectory() as tmp:
        pdf = Path(tmp) / "invoice.pdf"
        doc = fitz.open()
        doc.new_page().insert_text((72, 90), INVOICE, fontsize=12)
        doc.save(pdf)
        doc.close()

        health = call("GET", "/health")
        print("health:", health)
        assert health["configured"], "no model configured in the environment"

        print("test-model:", call("POST", "/test-model"))

        parsed = call("POST", "/parse", path=str(pdf), mode="local")
        assert "INV-2041" in parsed["markdown"] and parsed["read"] == "local"
        print("parse: ok,", parsed["characters"], "characters")

        schema = call(
            "POST",
            "/schema",
            requirements="Invoice number, invoice date as YYYY-MM-DD, vendor name and total amount as a number.",
        )
        print("schema fields:", [(f["name"], f["type"]) for f in schema["fields"]])

        record = call("POST", "/extract", schema_id=schema["schema_id"], path=str(pdf))
        print("extract:", record)
        assert "INV-2041" in str(record["record"])

        restored = call(
            "POST",
            "/schema/restore",
            requirements="x",
            requirements_json=schema["requirements_json"],
        )
        assert [f["name"] for f in restored["fields"]] == [
            f["name"] for f in schema["fields"]
        ]
        print("schema restore: ok")

        nested = call(
            "POST",
            "/schema",
            requirements="Extract the invoice header: invoice number and vendor name. "
            "Extract every line item as a row with these fields: item name, quantity (number).",
        )
        again = call(
            "POST",
            "/schema/restore",
            requirements="x",
            requirements_json=nested["requirements_json"],
        )
        assert again["fields"] == nested["fields"], (
            "a restored nested field list must be identical"
        )
        call("POST", "/extract", schema_id=again["schema_id"], path=str(pdf))
        print("nested schema restore: ok")

        label = call(
            "POST", "/classify", path=str(pdf), classes=["invoice", "contract", "CV"]
        )
        print("classify:", label)
        assert label["label"] == "invoice"

        xlsx = Path(tmp) / "out.xlsx"
        call(
            "POST",
            "/export/xlsx",
            path=str(xlsx),
            sheets=[
                {
                    "name": "Results",
                    "columns": ["file", "total"],
                    "rows": [["invoice.pdf", 1240.5]],
                }
            ],
        )
        assert xlsx.stat().st_size > 0
        print("export: ok")
    print("ALL OK")


if __name__ == "__main__":
    main()
