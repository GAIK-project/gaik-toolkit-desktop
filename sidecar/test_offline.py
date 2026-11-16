"""Engine tests that need no model key and make no network calls.

    python -m pytest sidecar/test_offline.py -q

Run with the engine's Python (the packages in sidecar/requirements.txt plus pytest).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

os.environ["GAIK_DESKTOP_TOKEN"] = "test-token"
# No provider may be configured here, whatever the developer's shell holds.
for name in (
    "AZURE_API_KEY",
    "AZURE_ENDPOINT",
    "OPENAI_API_KEY",
    "AITTA_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
):
    os.environ.pop(name, None)
os.environ["LLM_PROVIDER"] = "azure"
sys.path.insert(0, str(Path(__file__).parent))

import pymupdf  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from openpyxl import load_workbook  # noqa: E402

import server  # noqa: E402

AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture()
def client():
    return TestClient(server.app, raise_server_exceptions=False)


@pytest.fixture()
def text_pdf(tmp_path: Path) -> Path:
    doc = pymupdf.open()
    doc.new_page().insert_text(
        (72, 90), "INVOICE\nInvoice number: INV-1\nTotal due: 10,00 EUR\n" * 3
    )
    path = tmp_path / "invoice.pdf"
    doc.save(path)
    return path


@pytest.fixture()
def scanned_pdf(tmp_path: Path) -> Path:
    doc = pymupdf.open()
    doc.new_page()  # a page with no text layer
    path = tmp_path / "scan.pdf"
    doc.save(path)
    return path


def test_requests_without_the_token_are_refused(client):
    assert client.get("/health").status_code == 401
    assert (
        client.get("/health", headers={"Authorization": "Bearer wrong"}).status_code
        == 401
    )
    assert client.post("/parse", json={"path": "x"}).status_code == 401


def test_health_reports_no_model_without_keys(client):
    body = client.get("/health", headers=AUTH).json()
    assert body["ok"] is True
    assert body["configured"] is False
    assert body["gaik"]


def test_a_pdf_with_text_is_parsed_without_a_model(client, text_pdf):
    response = client.post(
        "/parse", headers=AUTH, json={"path": str(text_pdf), "mode": "auto"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["read"] == "local"
    assert "INV-1" in body["markdown"]


def test_a_text_file_is_read_as_it_is(client, tmp_path):
    note = tmp_path / "note.md"
    note.write_text("# Päiväkirja\nÄänite 1", encoding="utf-8")
    body = client.post("/parse", headers=AUTH, json={"path": str(note)}).json()
    assert body["markdown"] == "# Päiväkirja\nÄänite 1"


def test_a_scan_in_local_mode_is_a_clear_error(client, scanned_pdf):
    response = client.post(
        "/parse", headers=AUTH, json={"path": str(scanned_pdf), "mode": "local"}
    )
    assert response.status_code == 400
    assert "no text layer" in response.json()["error"]


def test_a_scan_without_a_key_asks_for_one(client, scanned_pdf):
    response = client.post(
        "/parse", headers=AUTH, json={"path": str(scanned_pdf), "mode": "auto"}
    )
    assert response.status_code == 400
    assert "Settings" in response.json()["error"]


@pytest.mark.parametrize(
    ("route", "body"),
    [
        ("/schema", {"requirements": "invoice number and total"}),
        ("/test-model", None),
    ],
)
def test_model_routes_ask_for_a_key(client, route, body):
    response = client.post(route, headers=AUTH, json=body)
    assert response.status_code == 400
    assert "Settings" in response.json()["error"]


def test_a_missing_file_is_named(client, tmp_path):
    response = client.post(
        "/parse", headers=AUTH, json={"path": str(tmp_path / "gone.pdf")}
    )
    assert response.status_code == 400
    assert response.json()["error"] == "File not found: gone.pdf"


def test_an_unknown_schema_is_a_clear_error(client, text_pdf):
    response = client.post(
        "/extract", headers=AUTH, json={"schema_id": "nope", "path": str(text_pdf)}
    )
    assert response.status_code == 400
    assert "Generate the fields again" in response.json()["error"]


def test_a_saved_flat_field_list_is_restored_without_a_model(client):
    requirements = {
        "use_case_name": "invoice",
        "fields": [
            {
                "field_name": "invoice_number",
                "field_type": "str",
                "description": "Number",
                "required": True,
            },
            {
                "field_name": "total",
                "field_type": "float",
                "description": "Total",
                "required": False,
            },
        ],
    }
    response = client.post(
        "/schema/restore",
        headers=AUTH,
        json={"requirements": "x", "requirements_json": requirements},
    )
    assert response.status_code == 200
    assert [f["name"] for f in response.json()["fields"]] == ["invoice_number", "total"]


def test_a_saved_field_list_with_a_repeated_group_is_restored(client):
    def field(name: str) -> dict:
        return {
            "field_name": name,
            "field_type": "str",
            "description": name,
            "required": False,
        }

    requirements = {
        "structure_type": "parent_with_nested_list",
        "parent_requirements": {
            "use_case_name": "invoice",
            "fields": [field("invoice_number")],
        },
        "children": [
            {
                "container_name": "line_items",
                "container_description": "Invoice lines",
                "requirements": {
                    "use_case_name": "line",
                    "fields": [field("item_name"), field("quantity")],
                },
            }
        ],
    }
    response = client.post(
        "/schema/restore",
        headers=AUTH,
        json={"requirements": "x", "requirements_json": requirements},
    )
    assert response.status_code == 200
    fields = response.json()["fields"]
    assert [f["name"] for f in fields] == ["invoice_number", "line_items"]
    assert [c["name"] for c in fields[1]["children"]] == ["item_name", "quantity"]


def test_excel_export_writes_one_sheet_per_group(client, tmp_path):
    target = tmp_path / "out.xlsx"
    sheets = [
        {
            "name": "Results",
            "columns": ["File", "Total"],
            "rows": [["a.pdf", 12.5], ["b.pdf", None]],
        },
        {
            "name": "Line/items: [x]",
            "columns": ["File", "Item"],
            "rows": [["a.pdf", {"nested": "ä"}]],
        },
    ]
    response = client.post(
        "/export/xlsx", headers=AUTH, json={"path": str(target), "sheets": sheets}
    )
    assert response.status_code == 200
    book = load_workbook(target)
    assert book.sheetnames == ["Results", "Lineitems x"]
    assert [c.value for c in book["Results"][2]] == ["a.pdf", 12.5]
    assert book["Lineitems x"]["B2"].value == '{"nested": "ä"}'


def test_a_key_never_appears_in_an_error_message(monkeypatch):
    monkeypatch.setenv("AZURE_API_KEY", "super-secret-key-123")
    message = server._provider_message(
        RuntimeError("Illegal header value b'Bearer super-secret-key-123'")
    )
    assert "super-secret-key-123" not in message
    assert "[hidden]" in message


def test_excel_export_drops_control_characters(client, tmp_path):
    target = tmp_path / "ctl.xlsx"
    sheets = [{"name": "R", "columns": ["Text"], "rows": [["page one\x0cpage two"]]}]
    response = client.post(
        "/export/xlsx", headers=AUTH, json={"path": str(target), "sheets": sheets}
    )
    assert response.status_code == 200
    assert load_workbook(target)["R"]["A2"].value == "page onepage two"


def test_a_broken_saved_field_list_is_a_clear_error(client):
    response = client.post(
        "/schema/restore",
        headers=AUTH,
        json={"requirements": "x", "requirements_json": {"fields": "nope"}},
    )
    assert response.status_code == 400
    assert "Generate the fields again" in response.json()["error"]


def test_blank_classes_do_not_count(client, text_pdf):
    response = client.post(
        "/classify", headers=AUTH, json={"path": str(text_pdf), "classes": ["a", "  "]}
    )
    assert response.status_code == 400
    assert response.json()["error"] == "Add at least two classes."
