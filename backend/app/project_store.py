from __future__ import annotations

import json
import hashlib
import threading
import uuid
from typing import Protocol

from .db import get_connection, now_iso
from .project_documents import SourceDocument


DEFAULT_PROJECT_ID = "inovaare-onboarding"


class ProjectStore(Protocol):
    def list_projects(self, user_id: str, is_manager: bool) -> list[dict]: ...
    def get_project(self, project_id: str, user_id: str, is_manager: bool) -> dict | None: ...
    def update_source(self, project_id: str, source_type: str, source_config: dict) -> dict | None: ...
    def list_sources(self, project_id: str) -> list[dict]: ...
    def create_source(self, project_id: str, name: str, connector_type: str, config: dict) -> dict | None: ...
    def update_project_source(self, project_id: str, source_id: str, changes: dict) -> dict | None: ...
    def delete_source(self, project_id: str, source_id: str) -> bool: ...
    def replace_documents(self, project_id: str, documents: tuple[SourceDocument, ...], manifest_hash: str, source_metadata: dict[str, dict] | None = None) -> dict: ...
    def replace_source_documents(self, project_id: str, source_id: str, source_name: str, documents: tuple[SourceDocument, ...], update_manifest: bool = True) -> dict: ...
    def get_documents(self, project_id: str) -> list[dict]: ...
    def create_course(self, course: dict) -> dict: ...
    def publish_course(self, project_id: str, course_id: str, published_by: str) -> dict | None: ...
    def assign_course(self, project_id: str, course_id: str, employee_ids: list[str], assigned_by: str) -> list[dict]: ...
    def create_attempt(self, project_id: str, user_id: str) -> dict | None: ...
    def get_attempt(self, project_id: str, attempt_id: str, user_id: str) -> dict | None: ...
    def complete_attempt(self, attempt_id: str, answers: dict, score: int, completed_at: str) -> dict: ...


_schema_lock = threading.Lock()
_schema_ready = False


def _json(value):
    if value is None or isinstance(value, (dict, list)):
        return value
    return json.loads(value)


def _iso(value):
    return value.isoformat() if value is not None and hasattr(value, "isoformat") else value


class PostgresProjectStore:
    """PostgreSQL persistence for project documents, courses and assignments."""

    def _ensure_schema(self) -> None:
        global _schema_ready
        if _schema_ready:
            return
        with _schema_lock:
            if _schema_ready:
                return
            with get_connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS projects (
                            id TEXT PRIMARY KEY,
                            name TEXT NOT NULL,
                            description TEXT NOT NULL DEFAULT '',
                            source_subpath TEXT NOT NULL DEFAULT '.',
                            source_type TEXT NOT NULL DEFAULT 'local',
                            source_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                            manifest_hash TEXT,
                            last_synced_at TIMESTAMPTZ,
                            created_at TIMESTAMPTZ NOT NULL,
                            updated_at TIMESTAMPTZ NOT NULL
                        )
                        """
                    )
                    cursor.execute(
                        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'local'"
                    )
                    cursor.execute(
                        """ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_config_json
                        JSONB NOT NULL DEFAULT '{}'::jsonb"""
                    )
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS project_sources (
                            id TEXT PRIMARY KEY,
                            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                            name TEXT NOT NULL,
                            connector_type TEXT NOT NULL,
                            config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                            enabled BOOLEAN NOT NULL DEFAULT TRUE,
                            created_at TIMESTAMPTZ NOT NULL,
                            updated_at TIMESTAMPTZ NOT NULL,
                            UNIQUE(project_id, name)
                        )
                        """
                    )
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS project_documents (
                            id TEXT PRIMARY KEY,
                            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                            source_path TEXT NOT NULL,
                            content_hash TEXT NOT NULL,
                            content TEXT NOT NULL,
                            size_bytes INTEGER NOT NULL,
                            source_url TEXT,
                            revision TEXT,
                            synced_at TIMESTAMPTZ NOT NULL,
                            UNIQUE(project_id, source_path)
                        )
                        """
                    )
                    cursor.execute(
                        "ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS source_url TEXT"
                    )
                    cursor.execute(
                        "ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS revision TEXT"
                    )
                    cursor.execute(
                        "ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS source_id TEXT REFERENCES project_sources(id) ON DELETE CASCADE"
                    )
                    cursor.execute(
                        "ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS source_name TEXT"
                    )
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS project_courses (
                            id TEXT PRIMARY KEY,
                            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                            title TEXT NOT NULL,
                            status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
                            content_json JSONB NOT NULL,
                            source_manifest_json JSONB NOT NULL,
                            generated_by TEXT NOT NULL REFERENCES users(id),
                            published_by TEXT REFERENCES users(id),
                            created_at TIMESTAMPTZ NOT NULL,
                            published_at TIMESTAMPTZ
                        )
                        """
                    )
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS project_assignments (
                            id TEXT PRIMARY KEY,
                            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                            course_id TEXT NOT NULL REFERENCES project_courses(id) ON DELETE CASCADE,
                            employee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                            assigned_by TEXT NOT NULL REFERENCES users(id),
                            status TEXT NOT NULL DEFAULT 'assigned',
                            assigned_at TIMESTAMPTZ NOT NULL,
                            completed_at TIMESTAMPTZ,
                            UNIQUE(course_id, employee_id)
                        )
                        """
                    )
                    cursor.execute(
                        """
                        CREATE TABLE IF NOT EXISTS project_attempts (
                            id TEXT PRIMARY KEY,
                            assignment_id TEXT NOT NULL REFERENCES project_assignments(id) ON DELETE CASCADE,
                            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                            course_id TEXT NOT NULL REFERENCES project_courses(id) ON DELETE CASCADE,
                            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                            status TEXT NOT NULL CHECK (status IN ('in-progress', 'completed')),
                            answers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                            score INTEGER,
                            started_at TIMESTAMPTZ NOT NULL,
                            completed_at TIMESTAMPTZ
                        )
                        """
                    )
                    timestamp = now_iso()
                    cursor.execute(
                        """
                        INSERT INTO projects (id, name, description, source_subpath, created_at, updated_at)
                        VALUES (%s, %s, %s, '.', %s, %s)
                        ON CONFLICT (id) DO NOTHING
                        """,
                        (
                            DEFAULT_PROJECT_ID,
                            "Revamped Knowledge Base",
                            "Onboarding generated from the local project knowledge base.",
                            timestamp,
                            timestamp,
                        ),
                    )
                    cursor.execute(
                        """
                        INSERT INTO project_sources
                            (id, project_id, name, connector_type, config_json, enabled, created_at, updated_at)
                        SELECT 'primary-' || p.id, p.id, 'Primary', p.source_type,
                               CASE WHEN p.source_type = 'local'
                                   THEN jsonb_build_object('sourceSubpath', p.source_subpath)
                                        || p.source_config_json
                                   ELSE p.source_config_json
                               END,
                               TRUE, p.created_at, p.updated_at
                        FROM projects p
                        WHERE NOT EXISTS (
                            SELECT 1 FROM project_sources ps WHERE ps.project_id = p.id
                        )
                        ON CONFLICT DO NOTHING
                        """
                    )
                    cursor.execute(
                        """
                        UPDATE project_documents d
                        SET source_id = ps.id, source_name = ps.name
                        FROM project_sources ps
                        WHERE d.project_id = ps.project_id
                          AND d.source_id IS NULL
                          AND ps.id = (
                              SELECT ps2.id FROM project_sources ps2
                              WHERE ps2.project_id = d.project_id
                              ORDER BY ps2.created_at, ps2.id LIMIT 1
                          )
                        """
                    )
                connection.commit()
            _schema_ready = True

    @staticmethod
    def _project_row(row: dict) -> dict:
        source_type = row.get("source_type") or "local"
        source_config = _json(row.get("source_config_json")) or {}
        return {
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "sourceSubpath": source_config.get("sourceSubpath", row["source_subpath"]),
            "sourceType": source_type,
            "sourceConfig": source_config,
            "connectorType": source_type,
            "config": source_config,
            "manifestHash": row.get("manifest_hash"),
            "lastSyncedAt": _iso(row.get("last_synced_at")),
            "documentCount": row.get("document_count", 0),
            "totalBytes": row.get("total_bytes", 0),
            "draftCourseCount": row.get("draft_course_count", 0),
            "publishedCourseCount": row.get("published_course_count", 0),
            "assignmentStatus": row.get("assignment_status"),
        }

    @staticmethod
    def _source_row(row: dict) -> dict:
        return {
            "id": row["id"],
            "projectId": row["project_id"],
            "name": row["name"],
            "connectorType": row["connector_type"],
            "config": _json(row.get("config_json")) or {},
            "enabled": bool(row.get("enabled", True)),
            "createdAt": _iso(row.get("created_at")),
            "updatedAt": _iso(row.get("updated_at")),
            "documentCount": row.get("document_count", 0),
            "totalBytes": row.get("total_bytes", 0),
        }

    @staticmethod
    def _course_row(row: dict) -> dict:
        return {
            "id": row["id"],
            "projectId": row["project_id"],
            "title": row["title"],
            "status": row["status"],
            "content": _json(row["content_json"]),
            "sourceManifest": _json(row["source_manifest_json"]),
            "generatedBy": row["generated_by"],
            "publishedBy": row.get("published_by"),
            "createdAt": _iso(row["created_at"]),
            "publishedAt": _iso(row.get("published_at")),
        }

    @staticmethod
    def _assignment_row(row: dict) -> dict:
        return {
            "id": row["id"],
            "projectId": row["project_id"],
            "courseId": row["course_id"],
            "employeeId": row["employee_id"],
            "assignedBy": row["assigned_by"],
            "status": row["status"],
            "assignedAt": _iso(row["assigned_at"]),
            "completedAt": _iso(row.get("completed_at")),
        }

    @staticmethod
    def _attempt_row(row: dict) -> dict:
        return {
            "id": row["id"],
            "assignmentId": row["assignment_id"],
            "projectId": row["project_id"],
            "courseId": row["course_id"],
            "userId": row["user_id"],
            "status": row["status"],
            "answers": _json(row["answers_json"]),
            "score": row["score"],
            "startedAt": _iso(row["started_at"]),
            "completedAt": _iso(row.get("completed_at")),
        }

    def list_projects(self, user_id: str, is_manager: bool) -> list[dict]:
        self._ensure_schema()
        visibility = "" if is_manager else "WHERE EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.project_id = p.id AND pa.employee_id = %s)"
        params = () if is_manager else (user_id,)
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT p.*,
                    (SELECT COUNT(*) FROM project_documents d WHERE d.project_id = p.id) AS document_count,
                    (SELECT COALESCE(SUM(d.size_bytes), 0) FROM project_documents d WHERE d.project_id = p.id) AS total_bytes,
                    (SELECT COUNT(*) FROM project_courses c WHERE c.project_id = p.id AND c.status = 'draft') AS draft_course_count,
                    (SELECT COUNT(*) FROM project_courses c WHERE c.project_id = p.id AND c.status = 'published') AS published_course_count,
                    (SELECT pa.status FROM project_assignments pa WHERE pa.project_id = p.id AND pa.employee_id = %s LIMIT 1) AS assignment_status
                FROM projects p
                {visibility}
                ORDER BY p.name
                """,
                (user_id, *params),
            )
            rows = cursor.fetchall()
        return [self._project_row(row) for row in rows]

    def get_project(self, project_id: str, user_id: str, is_manager: bool) -> dict | None:
        projects = [item for item in self.list_projects(user_id, is_manager) if item["id"] == project_id]
        if not projects:
            return None
        course_filter = "" if is_manager else "AND c.status = 'published' AND EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.course_id = c.id AND pa.employee_id = %s)"
        params = (project_id,) if is_manager else (project_id, user_id)
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"""SELECT c.* FROM project_courses c
                WHERE c.project_id = %s {course_filter}
                ORDER BY c.created_at DESC""",
                params,
            )
            courses = [self._course_row(row) for row in cursor.fetchall()]
            cursor.execute(
                """SELECT * FROM project_assignments
                WHERE project_id = %s AND (%s OR employee_id = %s)
                ORDER BY assigned_at DESC""",
                (project_id, is_manager, user_id),
            )
            assignments = [self._assignment_row(row) for row in cursor.fetchall()]
            cursor.execute(
                """SELECT source_path, content_hash, size_bytes, source_url, revision,
                    source_id, source_name, synced_at
                FROM project_documents WHERE project_id = %s ORDER BY source_path""",
                (project_id,),
            )
            documents = [
                {
                    "sourcePath": row["source_path"],
                    "contentHash": row["content_hash"],
                    "sizeBytes": row["size_bytes"],
                    "sourceUrl": row.get("source_url"),
                    "revision": row.get("revision"),
                    "sourceId": row.get("source_id"),
                    "sourceName": row.get("source_name"),
                    "syncedAt": _iso(row["synced_at"]),
                }
                for row in cursor.fetchall()
            ] if is_manager else []
        sources = self.list_sources(project_id)
        project = {**projects[0], "courses": courses, "assignments": assignments, "documents": documents, "sources": sources}
        if sources:
            primary = sources[0]
            project.update(
                sourceType=primary["connectorType"],
                sourceConfig=primary["config"],
                connectorType=primary["connectorType"],
                config=primary["config"],
                sourceSubpath=primary["config"].get("sourceSubpath", "."),
            )
        return project

    def list_sources(self, project_id: str) -> list[dict]:
        self._ensure_schema()
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """SELECT ps.*,
                    (SELECT COUNT(*) FROM project_documents d WHERE d.source_id = ps.id) AS document_count,
                    (SELECT COALESCE(SUM(d.size_bytes), 0) FROM project_documents d WHERE d.source_id = ps.id) AS total_bytes
                FROM project_sources ps WHERE ps.project_id = %s
                ORDER BY ps.created_at, ps.id""",
                (project_id,),
            )
            return [self._source_row(row) for row in cursor.fetchall()]

    def create_source(self, project_id: str, name: str, connector_type: str, config: dict) -> dict | None:
        self._ensure_schema()
        timestamp = now_iso()
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT id FROM projects WHERE id = %s FOR UPDATE", (project_id,))
            if not cursor.fetchone():
                return None
            cursor.execute(
                """INSERT INTO project_sources
                (id, project_id, name, connector_type, config_json, enabled, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s::jsonb, TRUE, %s, %s) RETURNING *""",
                (str(uuid.uuid4()), project_id, name, connector_type, json.dumps(config), timestamp, timestamp),
            )
            row = cursor.fetchone()
            cursor.execute(
                "UPDATE projects SET manifest_hash = NULL, last_synced_at = NULL, updated_at = %s WHERE id = %s",
                (timestamp, project_id),
            )
            connection.commit()
        return self._source_row(row)

    def update_project_source(self, project_id: str, source_id: str, changes: dict) -> dict | None:
        self._ensure_schema()
        timestamp = now_iso()
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT * FROM project_sources WHERE id = %s AND project_id = %s FOR UPDATE",
                (source_id, project_id),
            )
            current = cursor.fetchone()
            if not current:
                return None
            name = changes.get("name", current["name"])
            connector_type = changes.get("connectorType", current["connector_type"])
            config = changes.get("config", _json(current["config_json"]) or {})
            enabled = changes.get("enabled", current["enabled"])
            changed = (
                name != current["name"]
                or connector_type != current["connector_type"]
                or config != (_json(current["config_json"]) or {})
                or enabled != current["enabled"]
            )
            cursor.execute(
                """UPDATE project_sources SET name = %s, connector_type = %s,
                    config_json = %s::jsonb, enabled = %s, updated_at = %s
                WHERE id = %s AND project_id = %s RETURNING *""",
                (name, connector_type, json.dumps(config), enabled, timestamp, source_id, project_id),
            )
            row = cursor.fetchone()
            if changed:
                cursor.execute("DELETE FROM project_documents WHERE project_id = %s AND source_id = %s", (project_id, source_id))
                cursor.execute(
                    "UPDATE projects SET manifest_hash = NULL, last_synced_at = NULL, updated_at = %s WHERE id = %s",
                    (timestamp, project_id),
                )
            cursor.execute(
                """SELECT id FROM project_sources WHERE project_id = %s
                ORDER BY created_at, id LIMIT 1""",
                (project_id,),
            )
            primary = cursor.fetchone()
            if primary and primary["id"] == source_id:
                source_subpath = config.get("sourceSubpath", ".") if connector_type == "local" else "."
                cursor.execute(
                    """UPDATE projects SET source_type = %s, source_config_json = %s::jsonb,
                        source_subpath = %s, updated_at = %s WHERE id = %s""",
                    (connector_type, json.dumps(config), source_subpath, timestamp, project_id),
                )
            connection.commit()
        return self._source_row(row)

    def delete_source(self, project_id: str, source_id: str) -> bool:
        self._ensure_schema()
        timestamp = now_iso()
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM project_documents WHERE project_id = %s AND source_id = %s", (project_id, source_id))
            cursor.execute(
                "DELETE FROM project_sources WHERE project_id = %s AND id = %s RETURNING id",
                (project_id, source_id),
            )
            deleted = cursor.fetchone() is not None
            if deleted:
                cursor.execute(
                    "UPDATE projects SET manifest_hash = NULL, last_synced_at = NULL, updated_at = %s WHERE id = %s",
                    (timestamp, project_id),
                )
                cursor.execute(
                    """SELECT connector_type, config_json FROM project_sources
                    WHERE project_id = %s ORDER BY created_at, id LIMIT 1""",
                    (project_id,),
                )
                primary = cursor.fetchone()
                connector_type = primary["connector_type"] if primary else "local"
                config = (_json(primary["config_json"]) or {}) if primary else {}
                subpath = config.get("sourceSubpath", ".") if connector_type == "local" else "."
                cursor.execute(
                    """UPDATE projects SET source_type = %s, source_config_json = %s::jsonb,
                        source_subpath = %s WHERE id = %s""",
                    (connector_type, json.dumps(config), subpath, project_id),
                )
            connection.commit()
        return deleted

    def update_source(self, project_id: str, source_type: str, source_config: dict) -> dict | None:
        """Backward-compatible update of the project's first (primary) source."""
        sources = self.list_sources(project_id)
        if not sources:
            created = self.create_source(project_id, "Primary", source_type, source_config)
            if not created:
                return None
        else:
            self.update_project_source(
                project_id,
                sources[0]["id"],
                {"connectorType": source_type, "config": source_config},
            )
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """SELECT p.*,
                    (SELECT COUNT(*) FROM project_documents d WHERE d.project_id = p.id) AS document_count,
                    (SELECT COALESCE(SUM(size_bytes), 0) FROM project_documents d WHERE d.project_id = p.id) AS total_bytes
                FROM projects p WHERE p.id = %s""",
                (project_id,),
            )
            row = cursor.fetchone()
        return self._project_row(row) if row else None

    def replace_documents(self, project_id: str, documents: tuple[SourceDocument, ...], manifest_hash: str, source_metadata: dict[str, dict] | None = None) -> dict:
        self._ensure_schema()
        synced_at = now_iso()
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT id FROM projects WHERE id = %s FOR UPDATE", (project_id,))
            if not cursor.fetchone():
                raise KeyError(project_id)
            cursor.execute("DELETE FROM project_documents WHERE project_id = %s", (project_id,))
            cursor.execute(
                "SELECT id, name FROM project_sources WHERE project_id = %s ORDER BY created_at, id LIMIT 1",
                (project_id,),
            )
            primary = cursor.fetchone()
            cursor.executemany(
                """INSERT INTO project_documents
                (id, project_id, source_path, content_hash, content, size_bytes,
                 source_url, revision, source_id, source_name, synced_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                [
                    (
                        str(uuid.uuid4()), project_id, item.source_path, item.content_hash,
                        item.content, item.size_bytes, item.source_url, item.revision,
                        (source_metadata or {}).get(item.source_path, {}).get("sourceId", primary["id"] if primary else None),
                        (source_metadata or {}).get(item.source_path, {}).get("sourceName", primary["name"] if primary else None),
                        synced_at,
                    )
                    for item in documents
                ],
            )
            cursor.execute(
                "UPDATE projects SET manifest_hash = %s, last_synced_at = %s, updated_at = %s WHERE id = %s",
                (manifest_hash, synced_at, synced_at, project_id),
            )
            connection.commit()
        return {"documentCount": len(documents), "manifestHash": manifest_hash, "syncedAt": synced_at}

    def replace_source_documents(
        self,
        project_id: str,
        source_id: str,
        source_name: str,
        documents: tuple[SourceDocument, ...],
        update_manifest: bool = True,
    ) -> dict:
        self._ensure_schema()
        synced_at = now_iso()
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM project_sources WHERE project_id = %s AND id = %s FOR UPDATE",
                (project_id, source_id),
            )
            if not cursor.fetchone():
                raise KeyError(source_id)
            cursor.execute("DELETE FROM project_documents WHERE project_id = %s AND source_id = %s", (project_id, source_id))
            cursor.executemany(
                """INSERT INTO project_documents
                (id, project_id, source_path, content_hash, content, size_bytes,
                 source_url, revision, source_id, source_name, synced_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                [(str(uuid.uuid4()), project_id, item.source_path, item.content_hash, item.content,
                  item.size_bytes, item.source_url, item.revision, source_id, source_name, synced_at)
                 for item in documents],
            )
            cursor.execute(
                "SELECT source_path, content_hash FROM project_documents WHERE project_id = %s ORDER BY source_path",
                (project_id,),
            )
            rows = cursor.fetchall()
            digest = hashlib.sha256()
            for row in rows:
                digest.update(f'{row["source_path"]}:{row["content_hash"]}\n'.encode("utf-8"))
            manifest_hash = digest.hexdigest()
            if update_manifest:
                cursor.execute(
                    "UPDATE projects SET manifest_hash = %s, last_synced_at = %s, updated_at = %s WHERE id = %s",
                    (manifest_hash, synced_at, synced_at, project_id),
                )
            else:
                # A partial refresh must not make an existing course look fresh.
                # A project-wide sync establishes the next aggregate manifest.
                cursor.execute(
                    "UPDATE projects SET manifest_hash = NULL, last_synced_at = NULL, updated_at = %s WHERE id = %s",
                    (synced_at, project_id),
                )
            connection.commit()
        return {
            "documentCount": len(documents),
            "manifestHash": manifest_hash if update_manifest else None,
            "syncedAt": synced_at,
        }

    def get_documents(self, project_id: str) -> list[dict]:
        self._ensure_schema()
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """SELECT source_path, content_hash, content, size_bytes, source_url, revision,
                    source_id, source_name
                FROM project_documents WHERE project_id = %s ORDER BY source_path""",
                (project_id,),
            )
            return [dict(row) for row in cursor.fetchall()]

    def create_course(self, course: dict) -> dict:
        self._ensure_schema()
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO project_courses
                (id, project_id, title, status, content_json, source_manifest_json, generated_by, created_at)
                VALUES (%s, %s, %s, 'draft', %s::jsonb, %s::jsonb, %s, %s)
                ON CONFLICT (id) DO NOTHING
                RETURNING *""",
                (
                    course["id"], course["projectId"], course["title"], json.dumps(course["content"]),
                    json.dumps(course["sourceManifest"]), course["generatedBy"], course["createdAt"],
                ),
            )
            row = cursor.fetchone()
            if not row:
                cursor.execute("SELECT * FROM project_courses WHERE id = %s", (course["id"],))
                row = cursor.fetchone()
            connection.commit()
        return self._course_row(row)

    def publish_course(self, project_id: str, course_id: str, published_by: str) -> dict | None:
        self._ensure_schema()
        published_at = now_iso()
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """UPDATE project_courses SET status = 'published', published_by = %s, published_at = %s
                WHERE id = %s AND project_id = %s AND status = 'draft' RETURNING *""",
                (published_by, published_at, course_id, project_id),
            )
            row = cursor.fetchone()
            connection.commit()
        return self._course_row(row) if row else None

    def assign_course(self, project_id: str, course_id: str, employee_ids: list[str], assigned_by: str) -> list[dict]:
        self._ensure_schema()
        assigned_at = now_iso()
        rows = []
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM project_courses WHERE id = %s AND project_id = %s AND status = 'published'",
                (course_id, project_id),
            )
            if not cursor.fetchone():
                raise ValueError("A published course is required before assignment")
            for employee_id in employee_ids:
                cursor.execute(
                    """INSERT INTO project_assignments
                    (id, project_id, course_id, employee_id, assigned_by, status, assigned_at)
                    VALUES (%s, %s, %s, %s, %s, 'assigned', %s)
                    ON CONFLICT (course_id, employee_id) DO UPDATE SET assigned_by = EXCLUDED.assigned_by
                    RETURNING *""",
                    (str(uuid.uuid4()), project_id, course_id, employee_id, assigned_by, assigned_at),
                )
                rows.append(self._assignment_row(cursor.fetchone()))
            connection.commit()
        return rows

    def create_attempt(self, project_id: str, user_id: str) -> dict | None:
        self._ensure_schema()
        started_at = now_iso()
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """SELECT pa.*, c.content_json, c.title AS course_title
                FROM project_assignments pa JOIN project_courses c ON c.id = pa.course_id
                WHERE pa.project_id = %s AND pa.employee_id = %s AND pa.status <> 'completed' AND c.status = 'published'
                ORDER BY pa.assigned_at DESC LIMIT 1""",
                (project_id, user_id),
            )
            assignment = cursor.fetchone()
            if not assignment:
                return None
            cursor.execute(
                """SELECT * FROM project_attempts
                WHERE assignment_id = %s AND status = 'in-progress' ORDER BY started_at DESC LIMIT 1""",
                (assignment["id"],),
            )
            existing = cursor.fetchone()
            if existing:
                attempt = self._attempt_row(existing)
            else:
                cursor.execute(
                    """INSERT INTO project_attempts
                    (id, assignment_id, project_id, course_id, user_id, status, started_at)
                    VALUES (%s, %s, %s, %s, %s, 'in-progress', %s) RETURNING *""",
                    (str(uuid.uuid4()), assignment["id"], project_id, assignment["course_id"], user_id, started_at),
                )
                attempt = self._attempt_row(cursor.fetchone())
                cursor.execute("UPDATE project_assignments SET status = 'in-progress' WHERE id = %s", (assignment["id"],))
                connection.commit()
        attempt["courseTitle"] = assignment["course_title"]
        attempt["courseContent"] = _json(assignment["content_json"])
        return attempt

    def get_attempt(self, project_id: str, attempt_id: str, user_id: str) -> dict | None:
        self._ensure_schema()
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """SELECT a.*, c.title AS course_title, c.content_json
                FROM project_attempts a JOIN project_courses c ON c.id = a.course_id
                WHERE a.id = %s AND a.project_id = %s AND a.user_id = %s""",
                (attempt_id, project_id, user_id),
            )
            row = cursor.fetchone()
        if not row:
            return None
        attempt = self._attempt_row(row)
        attempt["courseTitle"] = row["course_title"]
        attempt["courseContent"] = _json(row["content_json"])
        return attempt

    def complete_attempt(self, attempt_id: str, answers: dict, score: int, completed_at: str) -> dict:
        self._ensure_schema()
        with get_connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """UPDATE project_attempts SET status = 'completed', answers_json = %s::jsonb,
                    score = %s, completed_at = %s WHERE id = %s AND status = 'in-progress' RETURNING *""",
                (json.dumps(answers), score, completed_at, attempt_id),
            )
            row = cursor.fetchone()
            if not row:
                raise ValueError("Attempt has already been submitted")
            cursor.execute(
                "UPDATE project_assignments SET status = 'completed', completed_at = %s WHERE id = %s",
                (completed_at, row["assignment_id"]),
            )
            connection.commit()
        return self._attempt_row(row)
