from __future__ import annotations

import json
import secrets
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

from domain.cad_assembly import CadAssemblySpec
from domain.cad_part import CadPartSpec
from domain.cad_program import CadProgramSpec
from pydantic import TypeAdapter

from api.cad_adapter import CadArtifact
from api.projects import RevisionConflictError

CadSpec = CadPartSpec | CadProgramSpec | CadAssemblySpec
_spec_adapter: TypeAdapter[CadSpec] = TypeAdapter(CadSpec)


class CadProjectNotFoundError(Exception):
    pass


class CadRevisionNotFoundError(Exception):
    pass


@dataclass(frozen=True)
class CadRevision:
    project_id: str
    revision: int
    spec: CadSpec
    artifact: CadArtifact


class CadProjectStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as connection, connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS cad_projects (
                    id TEXT PRIMARY KEY,
                    current_revision INTEGER NOT NULL
                )
            """)
            connection.execute("""
                CREATE TABLE IF NOT EXISTS cad_revisions (
                    project_id TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    spec_json TEXT NOT NULL,
                    step_blob BLOB NOT NULL,
                    volume_mm3 REAL NOT NULL,
                    bounds_json TEXT NOT NULL,
                    solid_count INTEGER NOT NULL DEFAULT 1,
                    PRIMARY KEY (project_id, revision),
                    FOREIGN KEY (project_id) REFERENCES cad_projects(id) ON DELETE CASCADE
                )
            """)
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(cad_revisions)")}
            if "solid_count" not in columns:
                connection.execute("ALTER TABLE cad_revisions ADD COLUMN solid_count INTEGER NOT NULL DEFAULT 1")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    @staticmethod
    def _record(row: sqlite3.Row) -> CadRevision:
        bounds = json.loads(row["bounds_json"])
        return CadRevision(
            project_id=row["project_id"],
            revision=row["revision"],
            spec=_spec_adapter.validate_json(row["spec_json"]),
            artifact=CadArtifact(
                step=row["step_blob"],
                volume_mm3=row["volume_mm3"],
                bounds_mm=(bounds[0], bounds[1], bounds[2]),
                solid_count=row["solid_count"],
            ),
        )

    @staticmethod
    def _insert_revision(
        connection: sqlite3.Connection, project_id: str, revision: int,
        spec: CadSpec, artifact: CadArtifact,
    ) -> None:
        connection.execute(
            "INSERT INTO cad_revisions (project_id, revision, spec_json, step_blob, volume_mm3, bounds_json, solid_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (project_id, revision, spec.model_dump_json(exclude_none=True), artifact.step,
             artifact.volume_mm3, json.dumps(artifact.bounds_mm), artifact.solid_count),
        )

    def create(self, spec: CadSpec, artifact: CadArtifact) -> CadRevision:
        project_id = f"cad_{secrets.token_urlsafe(18)}"
        with closing(self._connect()) as connection, connection:
            connection.execute("INSERT INTO cad_projects VALUES (?, 0)", (project_id,))
            self._insert_revision(connection, project_id, 0, spec, artifact)
        return CadRevision(project_id, 0, spec, artifact)

    def current(self, project_id: str) -> CadRevision:
        with closing(self._connect()) as connection, connection:
            row = connection.execute("""
                SELECT r.* FROM cad_revisions r
                JOIN cad_projects p ON p.id = r.project_id AND p.current_revision = r.revision
                WHERE p.id = ?
            """, (project_id,)).fetchone()
        if row is None:
            raise CadProjectNotFoundError(project_id)
        return self._record(row)

    def revision(self, project_id: str, revision: int) -> CadRevision:
        with closing(self._connect()) as connection, connection:
            row = connection.execute(
                "SELECT * FROM cad_revisions WHERE project_id = ? AND revision = ?",
                (project_id, revision),
            ).fetchone()
        if row is None:
            self.current(project_id)
            raise CadRevisionNotFoundError(f"CAD revision {revision} is unavailable")
        return self._record(row)

    def commit(
        self, project_id: str, expected_revision: int,
        spec: CadSpec, artifact: CadArtifact,
    ) -> CadRevision:
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT current_revision FROM cad_projects WHERE id = ?", (project_id,)
            ).fetchone()
            if row is None:
                raise CadProjectNotFoundError(project_id)
            current_revision = int(row["current_revision"])
            if current_revision != expected_revision:
                raise RevisionConflictError(project_id, expected_revision, current_revision)
            next_revision = current_revision + 1
            self._insert_revision(connection, project_id, next_revision, spec, artifact)
            connection.execute(
                "UPDATE cad_projects SET current_revision = ? WHERE id = ?",
                (next_revision, project_id),
            )
        return CadRevision(project_id, next_revision, spec, artifact)
