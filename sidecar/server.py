"""GAIK Desktop engine: the gaik toolkit behind a local HTTP API.

Started by the Electron main process on 127.0.0.1 with a per-run token. Every
request names files by their local path, so documents are read where they are
and never copied or uploaded anywhere except, as text or page images, to the
model provider the user configured.
"""

from __future__ import annotations

import hmac
import os
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

TOKEN = os.environ.get("GAIK_DESKTOP_TOKEN", "")

TEXT_SUFFIXES = {".txt", ".md", ".csv", ".json", ".html", ".htm", ".xml", ".log"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
AUDIO_SUFFIXES = {".mp3", ".wav", ".m4a", ".mp4", ".webm", ".ogg", ".flac"}
# A PDF with less text than this per page is treated as scanned.
MIN_CHARS_PER_PAGE = 40

app = FastAPI(title="GAIK Desktop engine", docs_url=None, redoc_url=None)

# Generated schemas live for the life of the process; the app keeps the
# requirements JSON and sends it back to rebuild one after a restart.
_schemas: dict[str, dict[str, Any]] = {}
_schemas_lock = threading.Lock()


class UserError(Exception):
    """A problem the user can fix; its message is shown as it is."""


@app.middleware("http")
async def require_token(request: Request, call_next):
    sent = request.headers.get("authorization", "")
    if not TOKEN or not hmac.compare_digest(sent, f"Bearer {TOKEN}"):
        return JSONResponse({"error": "Not allowed"}, status_code=401)
    return await call_next(request)


@app.exception_handler(UserError)
async def user_error(_request: Request, exc: UserError):
    return JSONResponse({"error": str(exc)}, status_code=400)


@app.exception_handler(Exception)
async def unexpected_error(_request: Request, exc: Exception):
    return JSONResponse({"error": _provider_message(exc)}, status_code=500)


def _provider_message(exc: Exception) -> str:
    text = str(exc).strip() or exc.__class__.__name__
    lowered = text.lower()
    if "401" in text or "invalid api key" in lowered or "unauthorized" in lowered:
        return "The model provider rejected the key. Check it in Settings."
    if "deploymentnotfound" in lowered or "404" in text:
        return f"The model or deployment was not found. Check the model name in Settings. ({text[:200]})"
    if "connection error" in lowered or "getaddrinfo" in lowered:
        return "Could not reach the model provider. Check the endpoint and your connection."
    return text[:600]


# ---------------------------------------------------------------------------
# Model configuration
# ---------------------------------------------------------------------------
def llm_config() -> dict[str, Any]:
    from gaik.software_components.llm import get_llm_config

    try:
        return get_llm_config()
    except ValueError as exc:
        raise UserError("Add a model key in Settings to use this.") from exc


# ---------------------------------------------------------------------------
# Reading files
# ---------------------------------------------------------------------------
def existing(path: str) -> Path:
    p = Path(path)
    if not p.is_file():
        raise UserError(f"File not found: {p.name}")
    return p


def pdf_text(path: Path) -> tuple[str, int]:
    import pymupdf as fitz

    with fitz.open(path) as doc:
        pages = [page.get_text() for page in doc]
    return "\n\n".join(pages).strip(), len(pages)


def local_text(path: Path) -> str | None:
    """Text read on this machine without a model, or None when there is none."""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        text, pages = pdf_text(path)
        return text if len(text) >= MIN_CHARS_PER_PAGE * max(pages, 1) else None
    if suffix == ".docx":
        from gaik.software_components.parsers import DocxParser

        return DocxParser().parse_docx(str(path))
    if suffix in TEXT_SUFFIXES:
        return path.read_text(encoding="utf-8", errors="replace")
    return None


def vision_markdown(path: Path) -> str:
    from gaik.software_components.parsers import VisionParser

    parser = VisionParser(llm_config())
    if path.suffix.lower() == ".pdf":
        return "\n\n".join(parser.convert_pdf(str(path)))
    if path.suffix.lower() in IMAGE_SUFFIXES:
        return parser.convert_image(path)
    raise UserError(f"{path.suffix or 'This file type'} cannot be read as page images.")


def document_text(path: Path, mode: str) -> tuple[str, str]:
    """Returns (text, how): how is "local" or "vision"."""
    if mode != "vision":
        text = local_text(path)
        if text is not None:
            return text, "local"
        if mode == "local":
            raise UserError(
                f"{path.name} has no text layer. Use the vision mode to read it with the model."
            )
    return vision_markdown(path), "vision"


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------
class SchemaRequest(BaseModel):
    requirements: str = Field(min_length=3)


class SchemaRestoreRequest(BaseModel):
    requirements: str
    requirements_json: dict[str, Any]


class ExtractRequest(BaseModel):
    schema_id: str
    path: str
    mode: str = "auto"  # auto | local | vision


class ParseRequest(BaseModel):
    path: str
    mode: str = "auto"


class ClassifyRequest(BaseModel):
    path: str
    classes: list[str] = Field(min_length=2)


class TranscribeRequest(BaseModel):
    path: str
    language: str = "auto"
    enhance: bool = False


class ExportRequest(BaseModel):
    path: str
    sheets: list[dict[str, Any]]  # {name, columns: [str], rows: [[value]]}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    from gaik import __version__

    configured = True
    model = None
    provider = None
    try:
        from gaik.software_components.llm import get_llm_config

        config = get_llm_config()
        model, provider = config.get("model"), config.get("provider")
    except ValueError:
        configured = False
    return {
        "ok": True,
        "gaik": __version__,
        "configured": configured,
        "model": model,
        "provider": provider,
    }


@app.post("/test-model")
def test_model():
    from gaik.software_components.llm import create_llm_client

    config = llm_config()
    reply = create_llm_client(config).chat(
        [{"role": "user", "content": "Reply with the single word: ready"}]
    )
    return {
        "ok": True,
        "model": reply.model or config.get("model"),
        "reply": reply.text[:80],
    }


def _describe(model_cls: type[BaseModel]) -> list[dict[str, Any]]:
    """Fields of a generated schema, for display: nested lists carry their own fields."""
    schema = model_cls.model_json_schema()
    defs = schema.get("$defs", {})

    def kind(prop: dict[str, Any]) -> tuple[str, list[dict[str, Any]] | None]:
        options = [o for o in prop.get("anyOf", [prop]) if o.get("type") != "null"]
        first = options[0] if options else prop
        if first.get("type") == "array":
            items = first.get("items", {})
            ref = items.get("$ref", "").split("/")[-1]
            if ref in defs:
                return "list", fields(defs[ref])
            return f"list of {items.get('type', 'text')}", None
        if "enum" in first:
            return "choice", None
        names = {
            "string": "text",
            "number": "number",
            "integer": "integer",
            "boolean": "yes/no",
        }
        return names.get(first.get("type", ""), first.get("type", "text")), None

    def fields(obj: dict[str, Any]) -> list[dict[str, Any]]:
        out = []
        for name, prop in obj.get("properties", {}).items():
            type_name, children = kind(prop)
            out.append(
                {
                    "name": name,
                    "type": type_name,
                    "description": prop.get("description", ""),
                    "children": children,
                }
            )
        return out

    return fields(schema)


def _remember(model_cls, requirements, text: str) -> dict[str, Any]:
    schema_id = uuid.uuid4().hex
    with _schemas_lock:
        _schemas[schema_id] = {
            "model": model_cls,
            "requirements": requirements,
            "text": text,
        }
    return {
        "schema_id": schema_id,
        "fields": _describe(model_cls),
        "requirements_json": requirements.model_dump(mode="json"),
    }


@app.post("/schema")
def make_schema(body: SchemaRequest):
    from gaik.software_components.extractor import SchemaGenerator

    generator = SchemaGenerator(config=llm_config())
    result = generator.generate_schema_with_usage(user_requirements=body.requirements)
    return _remember(result.schema, result.requirements, body.requirements)


@app.post("/schema/restore")
def restore_schema(body: SchemaRestoreRequest):
    """Rebuilds a saved field list exactly as it was, without a model call."""
    from gaik.software_components.extractor import (
        CompositeExtractionRequirements,
        ExtractionRequirements,
        create_extraction_model,
    )
    from pydantic import ConfigDict, create_model
    from pydantic import Field as PydanticField

    data = body.requirements_json
    if "parent_requirements" not in data:
        requirements = ExtractionRequirements.model_validate(data)
        return _remember(
            create_extraction_model(requirements), requirements, body.requirements
        )

    # One parent record with repeated groups: the parent's fields plus one list
    # per group, the same shape SchemaGenerator builds.
    composite = CompositeExtractionRequirements.model_validate(data)
    parent = create_extraction_model(composite.parent_requirements)
    fields: dict[str, Any] = {
        name: (info.annotation, info) for name, info in parent.model_fields.items()
    }
    for child in composite.children:
        child_model = create_extraction_model(child.requirements)
        fields[child.container_name] = (
            list[child_model],
            PydanticField(description=child.container_description),
        )
    model = create_model(
        f"{parent.__name__}_WithGroups", __config__=ConfigDict(extra="forbid"), **fields
    )
    return _remember(model, composite, body.requirements)


@app.post("/extract")
def extract(body: ExtractRequest):
    from gaik.software_components.extractor import DataExtractor

    with _schemas_lock:
        schema = _schemas.get(body.schema_id)
    if schema is None:
        raise UserError(
            "The field list is no longer loaded. Generate the fields again."
        )
    path = existing(body.path)
    config = llm_config()
    text, how = document_text(path, body.mode)
    if not text.strip():
        raise UserError(f"{path.name} is empty.")
    records = DataExtractor(config=config).extract(
        schema["model"], schema["requirements"], schema["text"], [text]
    )
    return {"record": records[0] if records else {}, "read": how}


@app.post("/parse")
def parse(body: ParseRequest):
    path = existing(body.path)
    text, how = document_text(path, body.mode)
    return {"markdown": text, "read": how, "characters": len(text)}


@app.post("/classify")
def classify(body: ClassifyRequest):
    from gaik.software_components.doc_classifier import DocumentClassifier

    path = existing(body.path)
    classes = [c.strip() for c in body.classes if c.strip()]
    result = DocumentClassifier(config=llm_config()).classify(str(path), classes)
    entry = next(iter(result.values()), None) if isinstance(result, dict) else None
    if not isinstance(entry, dict):
        raise UserError(f"{path.name} could not be classified.")
    return {
        "label": entry.get("class"),
        "confidence": entry.get("confidence"),
        "reasoning": entry.get("reasoning", ""),
    }


@app.post("/transcribe")
def transcribe(body: TranscribeRequest):
    from gaik.software_components.transcriber import Transcriber

    path = existing(body.path)
    if path.suffix.lower() not in AUDIO_SUFFIXES:
        raise UserError(f"{path.suffix} is not a supported audio or video format.")
    with tempfile.TemporaryDirectory(prefix="gaik-desktop-") as workdir:
        transcriber = Transcriber(
            api_config=llm_config(),
            output_dir=workdir,
            enhanced_transcript=body.enhance,
            language=body.language or "auto",
        )
        result = transcriber.transcribe(str(path))
    return {
        "text": result.enhanced_transcript or result.raw_transcript,
        "raw": result.raw_transcript,
        "enhanced": bool(result.enhanced_transcript),
    }


@app.post("/export/xlsx")
def export_xlsx(body: ExportRequest):
    from openpyxl import Workbook
    from openpyxl.styles import Font

    workbook = Workbook()
    workbook.remove(workbook.active)
    used: set[str] = set()
    for index, sheet in enumerate(body.sheets, start=1):
        # Excel: at most 31 characters, none of []:*?/\ and no duplicates.
        name = "".join(c for c in str(sheet.get("name") or "") if c not in "[]:*?/\\")[
            :31
        ]
        if not name or name.lower() in used:
            name = f"Sheet{index}"
        used.add(name.lower())
        ws = workbook.create_sheet(name)
        columns = [str(c) for c in sheet.get("columns", [])]
        ws.append(columns)
        for cell in ws[1]:
            cell.font = Font(bold=True)
        for row in sheet.get("rows", []):
            ws.append([_cell(v) for v in row])
        ws.freeze_panes = "A2"
        for i, column in enumerate(columns, start=1):
            width = max(
                [len(column)]
                + [
                    len(str(r[i - 1]))
                    for r in sheet.get("rows", [])[:200]
                    if i <= len(r)
                ]
            )
            ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = min(
                max(width + 2, 10), 60
            )
    if not workbook.sheetnames:
        raise HTTPException(status_code=400, detail="Nothing to export")
    workbook.save(body.path)
    return {"ok": True, "path": body.path}


def _cell(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    import json

    return json.dumps(value, ensure_ascii=False)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("GAIK_DESKTOP_PORT", "8765")),
        log_level="warning",
    )
