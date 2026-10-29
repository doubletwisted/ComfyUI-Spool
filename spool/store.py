import copy
import hashlib
import json
import logging
import re
import sqlite3
import time
import threading
import uuid
from collections import OrderedDict
from contextlib import contextmanager
from pathlib import Path, PurePath
from urllib.parse import quote

from .errors import NotFound, RevisionConflict, OperationConflict
from . import attempts, embedded, ledger, operations


def read_only_uri(path):
    """A SQLite URI that opens path read-only and unchanging, on UNC shares too.

    SQLite accepts only an empty or "localhost" URI authority, so a UNC host stays in the path.
    """
    posix = (path if isinstance(path, PurePath) else Path(path)).as_posix()
    return "file:" + ("//" if posix.startswith("/") else "///") + quote(posix, safe="/:") + "?mode=ro&immutable=1"


def uid():
    return str(uuid.uuid4())


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def encode_ordered(value):
    """Storage for payloads whose own key order is part of what was received."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def fingerprint(value):
    return hashlib.sha256(encode(value).encode()).hexdigest()


Conflict = RevisionConflict


SCHEMA_VERSION = 7
EXPORT_VERSION = 1


def validate_import(value):
    if "spoolVersion" in value and (type(value["spoolVersion"]) is not int or value["spoolVersion"] != EXPORT_VERSION):
        raise ValueError("Unsupported Spool export version; use a compatible Spool version")


# The revision ledger wrote a second full copy of every document on every save and
# had no reader anywhere in the extension. Version 4 drops it; the live revision
# counter in `projects` is what conflict detection has always used.
RETIRED_TABLES = ("revisions",)


def empty_project():
    return {
        "project": "Untitled Spool project",
        "clips": [],
        "media": [],
        "importedWorkflows": [],
        "audioClips": [],
        "tailGap": 0,
        "audioTracks": {"sourceMuted": False, "sourceSolo": False, "musicMuted": False, "musicSolo": False},
    }


def linked(value):
    return isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and isinstance(value[1], int)


def validate_capture(capture):
    prompt = capture.get("prompt")
    if (
        not isinstance(prompt, dict)
        or not prompt
        or not all(
            isinstance(k, str)
            and isinstance(v, dict)
            and isinstance(v.get("inputs"), dict)
            and isinstance(v.get("class_type"), str)
            for k, v in prompt.items()
        )
    ):
        raise ValueError("Capture an executable API prompt with Comfy's serializer")
    seen = set()
    for binding in capture.get("bindings", []):
        node, name = binding["nodeId"], binding["input"]
        if not isinstance(node, str) or node not in prompt or name not in prompt[node]["inputs"]:
            raise ValueError("Binding must use an exact execution node ID and API input name")
        if linked(prompt[node]["inputs"][name]):
            raise ValueError("Linked inputs cannot be bound; keep their edges in the workflow")
        if (node, name) in seen:
            raise ValueError("An input can only have one binding")
        seen.add((node, name))
        omit, bypass = binding.get("omit", []), binding.get("bypass", {})
        if (
            not isinstance(binding.get("group", ""), str)
            or not isinstance(omit, list)
            or not all(isinstance(n, str) for n in omit)
            or not isinstance(bypass, dict)
            or not all(isinstance(k, str) and isinstance(v, str) for k, v in bypass.items())
        ):
            raise ValueError("An optional input names its group and the nodes it leaves out")
    rules = capture.get("inputRules", [])
    if not isinstance(rules, list) or not all(
        isinstance(r, dict)
        and isinstance(r.get("message"), str)
        and isinstance(r.get("anyOf"), list)
        and all(isinstance(g, str) for g in r["anyOf"])
        for r in rules
    ):
        raise ValueError("Each input rule needs its groups and a message")
    saver = capture.get("result", {})
    if (
        saver.get("nodeId") not in prompt
        or saver.get("group") not in ("images", "gifs", "videos")
        or not isinstance(saver.get("index"), int)
        or saver["index"] < 0
    ):
        raise ValueError("Choose an exact result node, output group and artifact index")


CHANGED = "This project changed in another view. Reload before applying your edit."


class Edit:
    """One project document opened at its caller's revision inside a transaction."""

    def __init__(self, store, db, project_id, revision, document):
        self.store, self.db, self.project_id, self.revision, self.document = store, db, project_id, revision, document

    def save(self, document=None):
        """Store the authored document (this edit's, unless another is given) as the next revision."""
        working = self.store._write_document(
            self.db, self.project_id, ledger.authored(self.document if document is None else document)
        )
        self.db.execute(
            "UPDATE projects SET revision=?,document=? WHERE id=?",
            (self.revision + 1, self.store._dump(self.db, working), self.project_id),
        )
        return working

    def event(self, kind, data):
        self.store._event(self.db, self.project_id, kind, data)

    def setting(self, key, value):
        self.db.execute("INSERT OR REPLACE INTO settings VALUES(?,?)", (key, encode(value)))

    def forget_media_evidence(self, media_ids):
        """A moved or replaced external file must not resolve evidence at its old path."""
        self.db.executemany(
            "DELETE FROM media_evidence WHERE project_id=? AND media_id=?",
            ((self.project_id, identity) for identity in media_ids),
        )


class Store:
    def __init__(self, root, migrate=True, filename="spool.sqlite3"):
        self.focus_store = self
        self.root = Path(root).resolve()
        self.cache = self.root
        self.path = self.root / filename
        self.read_only = not migrate
        self._blobs = OrderedDict()
        self._blob_lock = threading.Lock()
        existing = self.path.exists()
        if not migrate:
            # Maintenance inspection: report on the file as it is, without running a
            # migration that could drop a table the operator has not agreed to yet.
            if not existing:
                raise NotFound("No Spool store at " + str(self.path))
            return
        self.root.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version > SCHEMA_VERSION:
                raise ValueError("This Spool database needs a newer extension version")
            if existing and version < 3 and self.path.name != "project.spool":
                backups = self.root / "backups"
                backups.mkdir(exist_ok=True)
                backup = sqlite3.connect(backups / ("schema-" + str(version) + "-" + uid() + ".sqlite3"))
                try:
                    db.backup(backup)
                finally:
                    backup.close()
            retired = self.migrate(db, version) if version < SCHEMA_VERSION else 0
        if (existing and version < 6) or retired >= self.COMPACT_AFTER_RETIREMENT:
            self.compact()

    # Frozen numbered steps: add a new step rather than editing a released one.
    MIGRATIONS = (
        (1, "base tables", "_schema"),
        (2, "execution tables", "_schema"),
        (3, "project ledger", "_schema"),
        (4, "retire revision snapshots", "_migration4"),
        (5, "separate media evidence", "_migration5"),
        (6, "store immutable evidence once", "_migration6"),
        (7, "retain completion times and operation identities", "_migration7"),
    )

    def _schema(self, db):
        sql = """
                CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, clip_id TEXT NOT NULL, fingerprint TEXT NOT NULL, capture TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, clip_id TEXT NOT NULL, take_id TEXT UNIQUE NOT NULL,
                    prompt_id TEXT UNIQUE NOT NULL, status TEXT NOT NULL, request TEXT NOT NULL, result TEXT, error TEXT, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS dispatches(attempt_id TEXT PRIMARY KEY, payload TEXT NOT NULL, validation TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, digest TEXT NOT NULL,
                    payload TEXT NOT NULL, attempt_ids TEXT NOT NULL, actor TEXT NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS events(cursor INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL,
                    kind TEXT NOT NULL, data TEXT NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS attempt_owners(attempt_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, claimed REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS host(id INTEGER PRIMARY KEY CHECK(id=1), configuration TEXT NOT NULL,
                    session_id TEXT NOT NULL, heartbeat REAL NOT NULL, definitions TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS handoffs(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, payload TEXT NOT NULL,
                    state TEXT NOT NULL, result TEXT, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY, attempt_id TEXT UNIQUE NOT NULL, target TEXT NOT NULL,
                    state TEXT NOT NULL, external_id TEXT, package TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS executions(id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, submission_id TEXT,
                    receipt TEXT NOT NULL, accepted INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS rejected_receipts(path TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, error TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS effects(operation_id TEXT PRIMARY KEY, state TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS command_results(id TEXT PRIMARY KEY, result TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, take_id TEXT NOT NULL, actor TEXT NOT NULL, document TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS focus(project_id TEXT NOT NULL, view_id TEXT NOT NULL, document TEXT NOT NULL, updated REAL NOT NULL, PRIMARY KEY(project_id,view_id));
                CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, document TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS media_evidence(project_id TEXT NOT NULL, media_id TEXT NOT NULL, evidence TEXT NOT NULL,
                    PRIMARY KEY(project_id,media_id));
        """
        for statement in sql.split(";"):
            if statement.strip():
                db.execute(statement)
        return 0

    def _migration4(self, db):
        self._schema(db)
        return self.retire_tables(db)

    def _migration5(self, db):
        self._schema(db)
        return self.split_media_evidence(db, 4)

    def _migration6(self, db):
        db.execute("CREATE TABLE blobs(hash TEXT PRIMARY KEY, data TEXT NOT NULL)")
        media_paths = {}
        for row in db.execute("SELECT id,document FROM projects"):
            for record in ledger.media_records(json.loads(row["document"])):
                media_paths[(row["id"], record["id"])] = record.get("originalFile") or record.get("file")
        for row in db.execute("SELECT project_id,result FROM attempts WHERE result IS NOT NULL"):
            for record in json.loads(row["result"]).get("artifacts", []):
                media_paths[(row["project_id"], record["id"])] = record.get("originalFile") or record.get("file")
        for table, column, receipt in (
            ("workflows", "capture", False),
            ("attempts", "request", False),
            ("attempts", "result", True),
            ("executions", "receipt", True),
            ("media_evidence", "evidence", False),
            ("dispatches", "payload", False),
        ):
            for row in db.execute(f"SELECT rowid,* FROM {table} WHERE {column} IS NOT NULL").fetchall():
                value = json.loads(row[column])
                if table == "media_evidence":
                    value = embedded.pack(value, media_paths.get((row["project_id"], row["media_id"])))
                packed = self._dump(db, value, receipt=receipt, capture=table == "workflows")
                db.execute(f"UPDATE {table} SET {column}=? WHERE rowid=?", (packed, row[0]))
        for row in db.execute("SELECT id,document FROM projects").fetchall():
            document = json.loads(row["document"])
            for record in ledger.media_records(document):
                evidence = db.execute(
                    "SELECT evidence FROM media_evidence WHERE project_id=? AND media_id=?", (row["id"], record["id"])
                ).fetchone()
                if evidence:
                    ledger.mark(record, self._load(evidence[0], db, media="references"))
            db.execute("UPDATE projects SET document=? WHERE id=?", (self._dump(db, document), row["id"]))
        return 0

    def _migration7(self, db):
        db.execute("ALTER TABLE attempts ADD COLUMN finished_at REAL")
        db.execute(
            "CREATE TABLE operation_tombstones(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, digest TEXT NOT NULL)"
        )
        db.execute("CREATE INDEX events_project_cursor ON events(project_id,cursor)")
        db.execute("CREATE INDEX attempts_status ON attempts(status)")
        db.execute("""UPDATE attempts SET finished_at=coalesce((
            SELECT max(created) FROM events WHERE project_id=attempts.project_id AND
            coalesce(json_extract(data,'$.attemptId'),json_extract(data,'$.result.attemptId'))=attempts.id AND
            (kind='execution.collected' AND json_extract(data,'$.accepted')=1 OR
             kind='attempt.status' AND json_extract(data,'$.status') IN ('complete','failed','cancelled') OR
             kind='command.cancel' AND json_extract(data,'$.result.status')='cancelled')
            ),created) WHERE status IN ('complete','failed','cancelled')""")
        return 0

    def retain_history(self, now=None, days=30):
        """Expire diagnostic/replay payloads, never the identities that prevent retries.

        Pending cancellation effects keep their operation payload. Execution receipts
        remain evidence for late delivery and are not diagnostic history.
        """
        cutoff = (time.time() if now is None else now) - days * 86400
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                """INSERT OR IGNORE INTO operation_tombstones
                SELECT id,project_id,digest FROM operations WHERE created<? AND
                id NOT IN (SELECT effects.operation_id FROM effects
                    LEFT JOIN command_results ON command_results.id=effects.operation_id
                    LEFT JOIN attempts ON attempts.id=json_extract(command_results.result,'$.attemptId')
                    WHERE effects.state NOT IN ('done','sent') OR attempts.status NOT IN ('complete','failed','cancelled'))""",
                (cutoff,),
            )
            db.execute("DELETE FROM command_results WHERE id IN (SELECT id FROM operation_tombstones)")
            db.execute("DELETE FROM effects WHERE operation_id IN (SELECT id FROM operation_tombstones)")
            db.execute("DELETE FROM operations WHERE id IN (SELECT id FROM operation_tombstones)")
            # Keep each project's latest cursor so an idle poll cannot go backwards.
            db.execute(
                "DELETE FROM events WHERE created<? AND cursor NOT IN (SELECT max(cursor) FROM events GROUP BY project_id)",
                (cutoff,),
            )
            db.execute(
                "DELETE FROM attempt_owners WHERE attempt_id IN (SELECT id FROM attempts WHERE finished_at<?)",
                (cutoff,),
            )

    def _check_tombstone(self, db, identity):
        if db.execute("SELECT 1 FROM operation_tombstones WHERE id=?", (identity,)).fetchone():
            raise OperationConflict("Operation ID has expired; inspect current state before using a new ID")

    def migrate(self, db, version):
        retired = 0
        for number, name, method in self.MIGRATIONS:
            if number <= version:
                continue
            db.execute("BEGIN IMMEDIATE")
            try:
                retired += getattr(self, method)(db) or 0
                db.execute("PRAGMA user_version=%d" % number)
                db.commit()
            except BaseException:
                db.rollback()
                with self._blob_lock:
                    self._blobs.clear()
                raise
        return retired

    def _blob(self, db, value):
        data = encode(value)
        digest = hashlib.sha256(data.encode()).hexdigest()
        db.execute("INSERT OR IGNORE INTO blobs VALUES(?,?)", (digest, data))
        return {"__spool_blob__": digest}

    def _prompt_blob(self, db, value):
        # Seeds and filenames change a few API nodes per take, not the whole prompt.
        if (
            isinstance(value, dict)
            and value
            and all(isinstance(v, dict) and "class_type" in v and "inputs" in v for v in value.values())
        ):
            value = {k: self._blob(db, v) for k, v in value.items()}
        elif isinstance(value, dict) and isinstance(value.get("nodes"), list):
            value = {**value, "nodes": [self._blob(db, node) for node in value["nodes"]]}
            if isinstance(value.get("definitions"), dict):
                definitions = dict(value["definitions"])
                if isinstance(definitions.get("subgraphs"), list):
                    definitions["subgraphs"] = [self._prompt_blob(db, graph) for graph in definitions["subgraphs"]]
                value["definitions"] = self._blob(db, definitions)
        return self._blob(db, value)

    def _pack(self, db, value):
        if isinstance(value, list):
            return [self._pack(db, v) for v in value]
        if not isinstance(value, dict):
            return value
        value = dict(value)
        if isinstance(value.get("probe"), dict):
            from .workflows import workflow_metadata

            probe = copy.deepcopy(value["probe"])
            for key, held in workflow_metadata(probe).items():
                value.setdefault(key, held)
            if isinstance(probe.get("format"), dict):
                probe["format"].pop("tags", None)
            value["probe"] = probe
        if value.get("kind") in ("image", "video", "audio"):
            value = embedded.pack(value)
        if embedded.is_reference(value):
            return value
        return {
            k: self._blob(db, self._pack(db, v))
            if k == "capture"
            else self._prompt_blob(db, v)
            if k in {"workflow", "prompt", "observedPrompt", "stagedPrompt"} and isinstance(v, (dict, list))
            else self._pack(db, v)
            for k, v in value.items()
        }

    def _dump(self, db, value, *, receipt=False, capture=False):
        if receipt:
            value = copy.deepcopy(value)
            if "primary" in value and "artifacts" in value:
                primary = value.pop("primary")
                identity = primary.get("artifactId", primary.get("id"))
                canonical = next((a for a in value["artifacts"] if a.get("artifactId", a.get("id")) == identity), None)
                if canonical != primary:
                    raise ValueError("Receipt primary differs from its canonical artifact")
                value["__spool_primary__"] = "primaryArtifactId" in value
                value["primaryArtifactId"] = identity
            # History often repeats the graph embedded in a collected artifact.
            history = value.get("history", {}).get("prompt")
            if isinstance(history, list) and len(history) > 3 and isinstance(history[3], dict):
                extra = history[3].get("extra_pnginfo", {})
                for artifact in value.get("artifacts", []):
                    if extra.get("workflow") and extra["workflow"] == artifact.get("workflow"):
                        path = artifact.get("originalFile") or artifact.get("file")
                        if path:
                            extra["workflow"] = embedded.reference(path, "workflow", extra["workflow"])
                            break
            if isinstance(value.get("history"), dict) and "prompt" in value["history"]:
                # Preserve the entire execution tuple, with its large members shared.
                prompt = value["history"].pop("prompt")
                value["__spool_history_prompt__"] = (
                    [self._prompt_blob(db, v) if i == 2 else self._pack(db, v) for i, v in enumerate(prompt)]
                    if isinstance(prompt, list)
                    else self._blob(db, prompt)
                )
        packed = self._pack(db, value)
        return encode(self._blob(db, packed) if receipt or capture else packed)

    def _unpack(self, db, value, memo, media, files):
        if isinstance(value, list):
            return [self._unpack(db, v, memo, media, files) for v in value]
        if not isinstance(value, dict):
            return value
        if embedded.is_reference(value):
            return embedded.read(self.root, value, files) if media == "resolve" else dict(value)
        if set(value) == {"__spool_blob__"}:
            digest = value["__spool_blob__"]
            if digest in memo:
                return memo[digest]
            with self._blob_lock:
                held = self._blobs.get(digest)
                if held is None:
                    row = db.execute("SELECT data FROM blobs WHERE hash=?", (digest,)).fetchone()
                    if row is None:
                        raise ValueError("Missing project evidence blob: " + digest)
                    held = row[0]
                    if len(held) <= 256 * 1024:
                        self._blobs[digest] = held
                        if len(self._blobs) > 512:
                            self._blobs.popitem(last=False)
                else:
                    self._blobs.move_to_end(digest)
            # Cache text across reads; share decoded values only within one response.
            decoded = json.loads(held)
            result = self._unpack(db, decoded, memo, media, files) if "__spool_" in held else decoded
            memo[digest] = result
            return result
        result = {k: self._unpack(db, v, memo, media, files) for k, v in value.items()}
        if "__spool_primary__" in result:
            keep_id = result.pop("__spool_primary__")
            identity = result["primaryArtifactId"]
            result["primary"] = next(a for a in result["artifacts"] if a.get("artifactId", a.get("id")) == identity)
            if not keep_id:
                result.pop("primaryArtifactId")
        if "__spool_history_prompt__" in result:
            result["history"]["prompt"] = result.pop("__spool_history_prompt__")
        if media == "markers":
            refs = [k for k, v in result.items() if embedded.is_reference(v)]
            prepared = result.get("workflowData")
            prepared_refs = isinstance(prepared, dict) and bool(prepared.get("evidence"))
            if refs or prepared_refs:
                result["evidence"] = [k for k in ledger.EVIDENCE_KEYS if k in result]
                if any(result[k].get("graph") for k in refs) or prepared_refs and prepared.get("embeddedGraph"):
                    result["embeddedGraph"] = True
                for key in refs:
                    result.pop(key)
        return result

    def _load(self, value, db=None, *, memo=None, media="markers", files=None):
        if value is None:
            return None
        with self._using(db) as db:
            return self._unpack(
                db, json.loads(value), memo if memo is not None else {}, media, files if files is not None else {}
            )

    def _projection_attempts(self, db, project_id):
        memo = {}
        return [
            {
                **dict(row),
                "request": self._load(row["request"], db, memo=memo),
                "result": self._load(row["result"], db, memo=memo),
            }
            for row in db.execute("SELECT * FROM attempts WHERE project_id=? ORDER BY created,rowid", (project_id,))
        ]

    def _attempt_row(self, db, row):
        if row is None:
            return None
        result = dict(row)
        result.pop("finished_at", None)
        for key in ("request", "result"):
            if result[key] is not None:
                result[key] = encode(self._load(result[key], db))
        return result

    # Retiring a table returns its pages to the freelist, not to the filesystem.
    # The evidence migration always compacts after commit; retirement-only
    # compaction can also be requested for a large payload.
    COMPACT_AFTER_RETIREMENT = 32 * 1024 * 1024

    def retire_tables(self, db):
        """Drop tables that a later schema version no longer has a reader for."""
        dropped = []
        for name in RETIRED_TABLES:
            row = db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone()
            if not row[0]:
                continue
            held = db.execute(
                "SELECT count(*), coalesce(sum(length(cast(document as blob))),0) FROM " + name
            ).fetchone()
            db.execute("DROP TABLE " + name)
            dropped.append((name, held[0], held[1]))
        payload = sum(chars for _, _, chars in dropped)
        for name, rows, chars in dropped:
            logging.info("Spool retired the write-only %s table (%d rows, %.1f MB of payload)", name, rows, chars / 1e6)
        return payload

    def split_media_evidence(self, db, version):
        """Move media evidence out of stored documents, once, on schema upgrade.

        The evidence stays; only where it lives changes. A document read by the
        editor or shipped to a browser carries the working edit and a marker naming
        the evidence each media record still has.
        """
        if version >= 5:
            return 0
        moved = 0
        for row in db.execute("SELECT id, revision, document FROM projects").fetchall():
            document = json.loads(row["document"])
            working, evidence = ledger.decompose(document, in_place=True)
            if not evidence:
                continue
            for media_id, held in evidence.items():
                existing = db.execute(
                    "SELECT evidence FROM media_evidence WHERE project_id=? AND media_id=?", (row["id"], media_id)
                ).fetchone()
                merged = {**json.loads(existing[0]), **held} if existing else held
                db.execute(
                    "INSERT OR REPLACE INTO media_evidence VALUES(?,?,?)", (row["id"], media_id, encode_ordered(merged))
                )
                moved += len(encode_ordered(merged))
            db.execute("UPDATE projects SET document=? WHERE id=?", (encode(working), row["id"]))
        if moved:
            logging.info(
                "Spool moved %.1f MB of media evidence out of project documents into media_evidence", moved / 1e6
            )
        return moved

    def evidence(self, project_id, media_id):
        """The probe and embedded graph for one media record, on demand."""
        with self.reading() as db:
            row = db.execute(
                "SELECT evidence FROM media_evidence WHERE project_id=? AND media_id=?", (project_id, media_id)
            ).fetchone()
            if row:
                return {"mediaId": media_id, **self._load(row[0], db, media="resolve")}
            for row in db.execute(
                "SELECT result FROM attempts WHERE project_id=? AND status='complete'", (project_id,)
            ):
                result = self._load(row[0], db, media="references")
                for record in [result["primary"], *result.get("artifacts", [])]:
                    if record["id"] == media_id:
                        held = {k: v for k, v in record.items() if k in ledger.EVIDENCE_KEYS}
                        return {"mediaId": media_id, **self._unpack(db, held, {}, "resolve", {})}
        raise NotFound("This media has no stored evidence")

    def all_evidence(self, project_id):
        """Every stored payload for a project, for a portable local draft."""
        media_ids = {m["id"] for m in ledger.media_records(self.projected(project_id))}
        with self.reading() as db:
            rows = db.execute(
                "SELECT media_id, evidence FROM media_evidence WHERE project_id=?", (project_id,)
            ).fetchall()
            results = db.execute(
                "SELECT result FROM attempts WHERE project_id=? AND status='complete'", (project_id,)
            ).fetchall()
            evidence = {
                row["media_id"]: self._load(row["evidence"], db, media="resolve")
                for row in rows
                if row["media_id"] in media_ids
            }
            for row in results:
                result = self._load(row[0], db, media="references")
                for record in [result["primary"], *result.get("artifacts", [])]:
                    if record["id"] not in media_ids:
                        continue
                    held = {key: value for key, value in record.items() if key in ledger.EVIDENCE_KEYS}
                    evidence[record["id"]] = {
                        **self._unpack(db, held, {}, "resolve", {}),
                        **evidence.get(record["id"], {}),
                    }
        return evidence

    def referenced_names(self):
        """Every file name any stored record mentions, so nothing in use is reclaimed.

        Reads the columns that can name a file once and collects the path-like tokens,
        including each token's basename, so a reference written as an absolute path or
        with Windows separators still protects its file.
        """
        columns = (
            ("projects", "document"),
            ("attempts", "request"),
            ("attempts", "result"),
            ("operations", "payload"),
            ("submissions", "package"),
            ("handoffs", "payload"),
            ("experiments", "document"),
            ("feedback", "document"),
            ("command_results", "result"),
            ("dispatches", "payload"),
            ("executions", "receipt"),
            ("workflows", "capture"),
            ("blobs", "data"),
        )
        names = set()
        with self.reading() as db:
            for table, column in columns:
                try:
                    rows = db.execute("SELECT %s FROM %s WHERE %s IS NOT NULL" % (column, table, column))
                except sqlite3.OperationalError:
                    continue
                for row in rows:
                    for token in re.findall(r"[A-Za-z0-9_\-./\\]+", row[0]):
                        names.add(token)
                        if "/" in token or "\\" in token:
                            names.add(token.replace("\\", "/").rsplit("/", 1)[-1])
        return names

    def derived_storage(self):
        """What each derived directory holds, and which previews nothing references."""
        names = self.referenced_names()
        folders = {}
        for folder in ("previews", "exports", "uploads", "shots", "artifacts", "assets", "backups"):
            directory = (self.cache if folder in ("previews", "shots") else self.root) / folder
            if not directory.is_dir():
                continue
            files = [path for path in directory.rglob("*") if path.is_file()]
            folders[folder] = {"files": len(files), "bytes": sum(path.stat().st_size for path in files)}
        previews = self.cache / "previews"
        unreferenced = []
        if previews.is_dir():
            for path in previews.rglob("*"):
                if not path.is_file():
                    continue
                if path.relative_to(self.root).as_posix() in names or path.name in names:
                    continue
                unreferenced.append(path)
        return {"folders": folders, "unreferencedPreviews": unreferenced}

    def prune(self, confirm=False, budget=5 * 1024**3, grace=600):
        """Report derived storage; with confirm, evict unreferenced previews over budget.

        Previews are the only evictable directory: they are rebuilt from the originals
        on demand. Uploads, shots, exports and artifacts may be the only copy of
        something, so they are reported and never removed.
        """
        report = self.derived_storage()
        unreferenced = report.pop("unreferencedPreviews")
        now = time.time()
        held = report["folders"].get("previews", {}).get("bytes", 0)
        report.update(
            {
                "previewBytes": held,
                "budgetBytes": budget,
                "unreferenced": len(unreferenced),
                "unreferencedBytes": sum(path.stat().st_size for path in unreferenced),
                "evicted": [],
                "freed": 0,
            }
        )
        if not confirm or held <= budget:
            return report
        candidates = [path for path in unreferenced if now - path.stat().st_mtime > grace]
        for path in sorted(candidates, key=lambda item: item.stat().st_mtime):
            if held <= budget:
                break
            size = path.stat().st_size
            try:
                path.unlink()
            except OSError:
                continue
            held -= size
            report["evicted"].append(path.relative_to(self.root).as_posix())
            report["freed"] += size
        report["previewBytes"] = held
        return report

    def compact(self):
        """Return free pages to the filesystem. Stop other hosts on this store first."""
        before = self.path.stat().st_size
        db = sqlite3.connect(self.path, timeout=120, isolation_level=None)
        try:
            db.execute("PRAGMA busy_timeout=120000")
            db.execute("VACUUM")
            db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            db.close()
        return before - self.path.stat().st_size

    def storage_report(self):
        """What a reclaim would free, without changing anything."""
        with self.reading() as db:
            page_size = db.execute("PRAGMA page_size").fetchone()[0]
            free = db.execute("PRAGMA freelist_count").fetchone()[0]
            retired = []
            for name in RETIRED_TABLES:
                row = db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone()
                if not row[0]:
                    continue
                held = db.execute(
                    "SELECT count(*), coalesce(sum(length(cast(document as blob))),0) FROM " + name
                ).fetchone()
                retired.append({"table": name, "rows": held[0], "payloadBytes": held[1]})
        return {
            "path": str(self.path),
            "bytes": self.path.stat().st_size,
            "freePages": free,
            "freeBytes": free * page_size,
            "retired": retired,
        }

    def reclaim(self, confirm=False):
        """Report, and on request drop, storage no reader depends on."""
        report = self.storage_report()
        report["reclaimed"] = 0
        if not confirm:
            return report
        with self.connect() as db:
            for entry in report["retired"]:
                db.execute("DROP TABLE " + entry["table"])
        reclaimed = self.compact()
        return {**self.storage_report(), "retired": report["retired"], "reclaimed": reclaimed}

    @contextmanager
    def connect(self):
        db = (
            sqlite3.connect(read_only_uri(self.path), uri=True)
            if self.read_only
            else sqlite3.connect(self.path, timeout=30)
        )
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @contextmanager
    def reading(self):
        with self.connect() as db:
            yield db

    @contextmanager
    def editing(self, project_id, revision, conflict=CHANGED):
        """Change one project at the revision its caller saw, atomically.

        Yields an Edit holding the stored working document. Nothing changes unless the
        block calls `save`; an exception rolls back everything the block wrote.
        """
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT revision,document FROM projects WHERE id=?", (project_id,)).fetchone()
            if not row:
                raise NotFound("Project not found")
            if row["revision"] != revision:
                raise Conflict(conflict)
            yield Edit(self, db, project_id, revision, self._load(row["document"], db))

    @contextmanager
    def _using(self, db=None):
        if db is not None:
            yield db
        else:
            with self.reading() as db:
                yield db

    def recipe(self, project_id, version, db=None):
        """A captured workflow version of this project, or None."""
        with self._using(db) as db:
            row = db.execute(
                "SELECT capture FROM workflows WHERE id=? AND project_id=?", (version, project_id)
            ).fetchone()
            return self._load(row[0], db) if row else None

    def project_attempts(self, project_id, db=None):
        with self._using(db) as db:
            return [
                self._attempt_row(db, r) for r in db.execute("SELECT * FROM attempts WHERE project_id=?", (project_id,))
            ]

    def project_attempt(self, project_id, attempt_id, db=None):
        with self._using(db) as db:
            return self._attempt_row(
                db,
                db.execute("SELECT * FROM attempts WHERE id=? AND project_id=?", (attempt_id, project_id)).fetchone(),
            )

    def submission_for(self, attempt_id, db=None):
        """The Deadline submission recorded for an attempt, or None."""
        with self._using(db) as db:
            return db.execute("SELECT * FROM submissions WHERE attempt_id=?", (attempt_id,)).fetchone()

    def submission_job(self, submission_id):
        with self.reading() as db:
            row = db.execute("SELECT external_id FROM submissions WHERE id=?", (submission_id,)).fetchone()
        return row[0] if row else None

    def adopt_submission_job(self, db, submission_id, job_id):
        """Record an accepted Deadline job found after a lost response."""
        old = db.execute("SELECT external_id FROM submissions WHERE id=?", (submission_id,)).fetchone()[0]
        if old and old != job_id:
            raise Conflict("Another external job already owns this submission")
        db.execute("UPDATE submissions SET state='acknowledged',external_id=? WHERE id=?", (job_id, submission_id))

    def execution(self, execution_id):
        """A collected farm execution with its stored receipt, or None."""
        with self.reading() as db:
            row = db.execute("SELECT * FROM executions WHERE id=?", (execution_id,)).fetchone()
        return {**dict(row), "receipt": self._load(row["receipt"])} if row else None

    def operation_payload(self, operation_id):
        with self.reading() as db:
            row = db.execute("SELECT payload FROM operations WHERE id=?", (operation_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def record_feedback(self, db, identity, project_id, take_id, actor, arguments):
        db.execute("INSERT INTO feedback VALUES(?,?,?,?,?)", (identity, project_id, take_id, actor, encode(arguments)))

    def recent_review(self, project_id):
        """The latest experiments and take feedback, for agent status."""
        with self.reading() as db:
            experiments = [
                {"id": r["id"], **json.loads(r["document"])}
                for r in db.execute(
                    "SELECT * FROM experiments WHERE project_id=? ORDER BY rowid DESC LIMIT 20", (project_id,)
                )
            ]
            feedback = [
                {**dict(r), "document": json.loads(r["document"])}
                for r in db.execute(
                    "SELECT * FROM feedback WHERE project_id=? ORDER BY rowid DESC LIMIT 50", (project_id,)
                )
            ]
        return experiments, feedback

    def cancellation_done(self, db, attempt_id):
        """Whether a cancel command confirmed delivery to this attempt's job."""
        return (
            db.execute(
                "SELECT 1 FROM effects JOIN command_results ON command_results.id=effects.operation_id WHERE json_extract(command_results.result,'$.attemptId')=? AND effects.state IN ('done','sent')",
                (attempt_id,),
            ).fetchone()
            is not None
        )

    def claim_cancellation(self, db, operation_id):
        db.execute("INSERT OR IGNORE INTO effects VALUES(?,'started')", (operation_id,))

    def start_cancellation(self, operation_id, attempt_id, submission_id, job_id):
        """Retry an unfinished delivery only while cancellation still applies."""
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            attempt = db.execute("SELECT status FROM attempts WHERE id=?", (attempt_id,)).fetchone()
            submission = self.submission_for(attempt_id, db)
            if (
                not attempt
                or attempt[0] != attempts.CANCEL_REQUESTED
                or not submission
                or (submission["id"], submission["external_id"]) != (submission_id, job_id)
                or self.cancellation_done(db, attempt_id)
            ):
                return False
            self.claim_cancellation(db, operation_id)
            return True

    def deleted_take_ids(self, project_id):
        with self.reading() as db:
            row = db.execute("SELECT document FROM projects WHERE id=?", (project_id,)).fetchone()
        return set(json.loads(row[0]).get("deletedTakeIds", [])) if row else set()

    def setting(self, key):
        with self.reading() as db:
            row = db.execute("SELECT document FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def for_project(self, project_id):
        if not self.exists(project_id):
            raise NotFound("Project not found")
        return self

    def project_stores(self):
        return [self]

    def lookup(self, table, identity):
        if table not in {"workflows", "handoffs", "attempts"}:
            raise ValueError("Unsupported project lookup")
        with self.reading() as db:
            if not db.execute("SELECT 1 FROM " + table + " WHERE id=?", (identity,)).fetchone():
                raise NotFound("Project record not found")
        return self

    def set_setting(self, key, value):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO settings VALUES(?,?)", (key, encode(value)))

    def _write_document(self, db, project_id, document):
        """Store the working document, keeping any evidence it carries.

        Evidence is merged per media id and never removed: a save from a current
        editor omits it entirely, so the stored rows stay authoritative, and a save
        from an older editor refreshes the keys it carries without dropping the rest.
        Markers are then rewritten from the merged truth, so a record cannot
        advertise a graph that the stored evidence no longer holds.
        """
        working, evidence = ledger.decompose(document, in_place=True)
        if not evidence:
            return working
        merged = {}
        paths = {r["id"]: r.get("originalFile") or r.get("file") for r in ledger.media_records(working)}
        for media_id, held in evidence.items():
            row = db.execute(
                "SELECT evidence FROM media_evidence WHERE project_id=? AND media_id=?", (project_id, media_id)
            ).fetchone()
            stored = {**self._load(row[0], db, media="references"), **held} if row else held
            stored = embedded.pack(stored, paths.get(media_id))
            packed = self._dump(db, stored)
            db.execute("INSERT OR REPLACE INTO media_evidence VALUES(?,?,?)", (project_id, media_id, packed))
            merged[media_id] = self._load(packed, db, media="references")
        for record in ledger.media_records(working):
            held = merged.get(record.get("id"))
            if held is not None:
                ledger.mark(record, held)
        return working

    def create(self, document=None):
        project_id = uid()
        document = ledger.authored(document or empty_project())
        with self.connect() as db:
            document = self._write_document(db, project_id, document)
            db.execute("INSERT INTO projects VALUES(?,?,?)", (project_id, 0, self._dump(db, document)))
        return self.get(project_id)

    def list(self):
        """Project names come out of the document with SQL, not by decoding it."""
        with self.reading() as db:
            return [
                {"id": r["id"], "revision": r["revision"], "name": r["name"] or "Untitled Spool project"}
                for r in db.execute(
                    "SELECT id, revision, json_extract(document,'$.project') AS name FROM projects ORDER BY rowid"
                )
            ]

    def exists(self, project_id):
        """An existence check must not decode a document or project the ledger."""
        with self.reading() as db:
            return db.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone() is not None

    def revision(self, project_id):
        with self.reading() as db:
            row = db.execute("SELECT revision FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise NotFound("Project not found")
        return row[0]

    def sync_state(self, project_id):
        """Check edits and receipts without loading documents, recipes or results."""
        with self.reading() as db:
            row = db.execute("SELECT revision FROM projects WHERE id=?", (project_id,)).fetchone()
            if not row:
                raise NotFound("Project not found")
            cursor = db.execute(
                "SELECT coalesce(max(cursor),0) FROM events WHERE project_id=?", (project_id,)
            ).fetchone()[0]
            jobs = [
                dict(r)
                for r in db.execute(
                    "SELECT id,status,error,prompt_id AS promptId,coalesce(json_extract(request,'$.target'),'local') AS target FROM attempts WHERE project_id=? AND status NOT IN ('complete','failed','cancelled') ORDER BY id",
                    (project_id,),
                )
            ]
            submissions = [
                dict(r)
                for r in db.execute(
                    "SELECT id,attempt_id,external_id,state FROM submissions WHERE attempt_id IN (SELECT id FROM attempts WHERE project_id=?) ORDER BY id",
                    (project_id,),
                )
            ]
        return {"id": project_id, "revision": row[0], "cursor": cursor, "jobs": jobs, "submissions": submissions}

    def document(self, project_id):
        """The working document alone: no recipes, attempts or generated-take projection."""
        with self.reading() as db:
            row = db.execute("SELECT document FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise NotFound("Project not found")
        return self._load(row[0])

    def frame_rate(self, project_id):
        """One scalar out of the document, without decoding it."""
        with self.reading() as db:
            row = db.execute("SELECT json_extract(document,'$.fps') FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise NotFound("Project not found")
        return row[0] or 24

    def projected(self, project_id):
        """The document with its generated takes attached.

        Generated takes live in the attempt ledger, not in the stored document, so a
        read that answers about clips or media must project them. Recipes and job
        annotation stay out; that is what makes this cheaper than `get`.
        """
        with self.reading() as db:
            row = db.execute("SELECT document FROM projects WHERE id=?", (project_id,)).fetchone()
            if not row:
                raise NotFound("Project not found")
            document = self._load(row["document"], db)
            attempts = self._projection_attempts(db, project_id)
        return ledger.attach(document, attempts)

    def clip(self, project_id, clip_id):
        clip = next((c for c in self.projected(project_id).get("clips", []) if c["id"] == clip_id), None)
        if not clip:
            raise ValueError("Choose a saved shot")
        return clip

    def take_media(self, project_id):
        document = self.projected(project_id)
        return [t["media"] for c in document.get("clips", []) for t in c.get("takes", []) if not t.get("placeholder")]

    def media_record(self, project_id, media_id, kinds=None):
        for record in ledger.media_records(self.projected(project_id)):
            if record.get("id") == media_id and (kinds is None or record.get("kind") in kinds):
                return record
        raise ValueError("This footage is no longer in the project")

    def active_attempts(self, project_id):
        with self.reading() as db:
            return db.execute(
                "SELECT count(*) FROM attempts WHERE project_id=? AND status NOT IN ('complete','failed','cancelled')",
                (project_id,),
            ).fetchone()[0]

    def scan_attempts(self, target=None, pending_only=False):
        """Every attempt the receipt scan must visit, without decoding any document."""
        conditions, values = [], []
        if target is not None:
            conditions.append("json_extract(request,'$.target')=?")
            values.append(target)
        if pending_only:
            conditions.append("status NOT IN ('complete','failed','cancelled')")
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        with self.reading() as db:
            rows = [
                self._attempt_row(db, r)
                for r in db.execute("SELECT * FROM attempts" + where + " ORDER BY created,rowid", values)
            ]
        for row in rows:
            row["request"] = json.loads(row["request"])
        return rows

    def folder_inventory(self, project_id):
        """Exact collected output paths and take ordinals, without frozen prompts."""
        with self.reading() as db:
            rows = db.execute(
                "SELECT clip_id,json_extract(request,'$.takeNumber') AS number,result FROM attempts WHERE project_id=?",
                (project_id,),
            ).fetchall()
            known, numbers, memo = set(), {}, {}
            for row in rows:
                numbers[row["clip_id"]] = max(numbers.get(row["clip_id"], 0), row["number"] or 0)
                result = self._load(row["result"], db, memo=memo) or {}
                known.update(a.get("originalFile", a.get("file")) for a in result.get("artifacts", []))
            return known, numbers

    def get(self, project_id):
        with self.reading() as db:
            row = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
            if not row:
                raise NotFound("Project not found")
            document = self._load(row["document"], db)
            attempts = self._projection_attempts(db, project_id)
            versions = {c["workflowVersion"] for c in document["clips"] if c.get("workflowVersion")}
            recipe_rows = (
                db.execute(
                    "SELECT id,capture FROM workflows WHERE id IN (" + ",".join("?" for _ in versions) + ")",
                    tuple(versions),
                )
                if versions
                else []
            )
            recipes = {r["id"]: self._load(r["capture"], db) for r in recipe_rows}
            submissions = {
                r["attempt_id"]: dict(r)
                for r in db.execute(
                    "SELECT id,attempt_id,external_id,state FROM submissions WHERE attempt_id IN (SELECT id FROM attempts WHERE project_id=?)",
                    (project_id,),
                )
            }
            finished = {a["id"]: a["finished_at"] for a in attempts}
        ledger.attach(document, attempts)
        for job in document["jobs"]:
            if job["status"] in {"complete", "failed", "cancelled"}:
                job["finishedAt"] = finished.get(job["id"])
            if job["id"] in submissions:
                job["submission"] = submissions[job["id"]]
        return {"id": project_id, "revision": row["revision"], "document": document, "recipes": recipes}

    def take_evidence(self, project_id, take_id):
        """Full generated-take evidence, scoped to its owning project."""
        with self.reading() as db:
            row = db.execute(
                "SELECT * FROM attempts WHERE project_id=? AND take_id=?", (project_id, take_id)
            ).fetchone()
            if not row:
                raise NotFound("Generated take not found")
            return {
                "id": take_id,
                "request": self._load(row["request"], db, media="resolve"),
                "result": self._load(row["result"], db, media="resolve"),
            }

    def save(self, project_id, revision, document, workflow_recipes=None):
        document = ledger.authored(document)
        with self.editing(project_id, revision) as edit:
            db = edit.db
            for version, capture in (workflow_recipes or {}).items():
                validate_capture(capture)
                owners = [c for c in document["clips"] if c.get("workflowVersion") == version]
                if not owners or any(c.get("bindings", []) != capture.get("bindings", []) for c in owners):
                    raise ValueError("A saved workflow must match its clip bindings")
                existing = db.execute("SELECT project_id,fingerprint FROM workflows WHERE id=?", (version,)).fetchone()
                digest = fingerprint(capture)
                if existing:
                    if existing["project_id"] != project_id or existing["fingerprint"] != digest:
                        raise Conflict("This immutable workflow version already contains a different capture")
                else:
                    db.execute(
                        "INSERT INTO workflows VALUES(?,?,?,?,?)",
                        (version, project_id, owners[0]["id"], digest, self._dump(db, capture, capture=True)),
                    )
            edit.save(document)
        return self.get(project_id)

    def capture(
        self, project_id, revision, clip_id, capture, overrides=None, take_id=None, reset_inputs=False, command=None
    ):
        if capture is not None:
            validate_capture(capture)
        elif take_id is None:
            raise ValueError("Choose a workflow or a take")
        with self.connect() as db:
            row = db.execute("SELECT document FROM projects WHERE id=?", (project_id,)).fetchone()
            if not row:
                raise NotFound("Project not found")
            document = json.loads(row[0])
            generated = (
                db.execute(
                    "SELECT clip_id,take_id,result FROM attempts WHERE project_id=? AND take_id=? AND status='complete'",
                    (project_id, take_id),
                ).fetchone()
                if take_id is not None
                else None
            )
        if generated:
            generated = {**dict(generated), "frames": self._load(generated["result"])["primary"]["frames"]}
        clip = next((c for c in document["clips"] if c["id"] == clip_id), None)
        if not clip:
            raise NotFound("Clip not found")
        if take_id is not None:
            take = next((t for t in clip["takes"] if t["id"] == take_id and not t.get("placeholder")), None)
            if (
                take is None
                and generated
                and ledger.owns(clip, generated)
                and take_id not in document.get("deletedTakeIds", [])
            ):
                take = {"media": {"frames": generated["frames"]}}
            if not take or take_id in clip.get("hiddenTakeIds", []) and take_id != clip.get("takeId"):
                raise ValueError("This take is no longer available for the shot")
            base = capture.get("provenance", {}).get("takeBase") if capture else None
            if capture and (not base or base["takeId"] != take_id):
                raise ValueError("Generation setup must belong to the chosen take")
            operations.choose_take(document, clip, take_id, take["media"]["frames"])
            clip["generationBase"] = base or {"takeId": take_id, "source": "No executable metadata"}
            clip.pop("workflow", None)
            clip.pop("shotInputs", None)
            clip.pop("seedKey", None)
            clip["seedMode"] = "same"
        else:
            clip.pop("generationBase", None)
        if reset_inputs:
            clip.pop("shotInputs", None)
            clip.pop("seedKey", None)
            clip["seedMode"] = "same"

        def apply_capture(db):
            if capture is not None:
                self._capture_clip(db, project_id, clip, capture, overrides)
            else:
                clip.pop("workflowVersion", None)
                clip["bindings"], clip["inputValues"] = [], {}
                clip["revision"] = clip.get("revision", 0) + 1

        if command is not None:
            envelope, result = command

            def apply(db, current):
                apply_capture(db)
                current.clear()
                current.update(document)
                return result, True

            return self.command(envelope["operationId"], project_id, revision, envelope, apply)
        with self.editing(project_id, revision, "Project changed before capture; reload and capture again") as edit:
            apply_capture(edit.db)
            edit.save(document)
        return self.get(project_id)

    def _capture_clip(self, db, project_id, clip, capture, overrides=None):
        snapshot_id = uid()
        clip["workflowVersion"] = snapshot_id
        clip["bindings"] = capture.get("bindings", [])
        clip["inputValues"] = {
            b["key"]: capture["prompt"][b["nodeId"]]["inputs"][b["input"]] for b in capture.get("bindings", [])
        }
        for key, value in (overrides or {}).items():
            if key in clip["inputValues"]:
                clip["inputValues"][key] = value
        clip["revision"] = clip.get("revision", 0) + 1
        db.execute(
            "INSERT INTO workflows VALUES(?,?,?,?,?)",
            (snapshot_id, project_id, clip["id"], fingerprint(capture), self._dump(db, capture, capture=True)),
        )

    def workflow(self, snapshot_id):
        with self.reading() as db:
            row = db.execute("SELECT capture FROM workflows WHERE id=?", (snapshot_id,)).fetchone()
        if not row:
            raise ValueError("Save an executable workflow to this clip first")
        return self._load(row[0])

    def handoff(self, project_id, payload):
        project = self.get(project_id)
        if payload.get("revision") != project["revision"]:
            raise Conflict("Save this project before opening a graph handoff")
        if payload.get("action") not in ("capture", "open", "prepare"):
            raise ValueError("Choose capture, open or prepare")
        if payload["action"] == "prepare" and not isinstance(payload.get("workflow", {}).get("nodes"), list):
            raise ValueError("Choose a saved Comfy workflow to prepare")
        clip = next((c for c in project["document"]["clips"] if c["id"] == payload.get("clipId")), None)
        if not clip and (payload["action"] == "open" or payload.get("clipId") is not None):
            raise ValueError("Select a saved clip for this handoff")
        identity = uid()
        payload = {**payload, "projectId": project_id, "workflowVersion": clip.get("workflowVersion") if clip else None}
        with self.connect() as db:
            db.execute(
                "INSERT INTO handoffs VALUES(?,?,?,'pending',NULL,?)",
                (identity, project_id, encode(payload), time.time()),
            )
            self._event(
                db,
                project_id,
                "graph.handoff",
                {"handoffId": identity, "clipId": clip["id"] if clip else None, "action": payload["action"]},
            )
        return self.read_handoff(identity)

    def read_handoff(self, identity):
        with self.reading() as db:
            row = db.execute("SELECT * FROM handoffs WHERE id=?", (identity,)).fetchone()
        if not row or time.time() - row["created"] > 600:
            raise ValueError("Graph handoff expired; open a new one")
        return {
            "id": identity,
            "payload": json.loads(row["payload"]),
            "state": row["state"],
            "result": json.loads(row["result"]) if row["result"] else None,
        }

    def finish_handoff(self, identity, result):
        self.read_handoff(identity)
        with self.connect() as db:
            changed = db.execute(
                "UPDATE handoffs SET state='complete',result=? WHERE id=? AND state='pending'",
                (encode(result), identity),
            )
            if changed.rowcount != 1:
                raise Conflict("This graph handoff was already consumed")
        return self.read_handoff(identity)

    def submission(self, attempt_id, package):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM submissions WHERE attempt_id=?", (attempt_id,)).fetchone()
            if not row:
                identity = uid()
                db.execute(
                    "INSERT INTO submissions VALUES(?,?,'deadline','intent',NULL,?)",
                    (identity, attempt_id, encode(package)),
                )
                row = db.execute("SELECT * FROM submissions WHERE id=?", (identity,)).fetchone()
        return {**dict(row), "package": json.loads(row["package"])}

    def acknowledge(self, submission_id, job_id):
        if not isinstance(job_id, str) or not job_id:
            raise ValueError("A submission acknowledgment requires an external job ID")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT * FROM submissions WHERE id=?", (submission_id,)).fetchone()
            if not old:
                raise ValueError("Unknown submission")
            if old["external_id"] and old["external_id"] != job_id:
                raise Conflict("Multiple Deadline jobs claim this submission; operator resolution required")
            if old["external_id"] == job_id and old["state"] == "acknowledged":
                return
            db.execute("UPDATE submissions SET state='acknowledged',external_id=? WHERE id=?", (job_id, submission_id))
            if not old["external_id"]:
                project_id = db.execute("SELECT project_id FROM attempts WHERE id=?", (old["attempt_id"],)).fetchone()[
                    0
                ]
                self._event(
                    db,
                    project_id,
                    "submission.acknowledged",
                    {"submissionId": submission_id, "attemptId": old["attempt_id"], "jobId": job_id},
                )

    def reject_receipt(self, attempt_id, path, error):
        with self.connect() as db:
            added = db.execute("INSERT OR IGNORE INTO rejected_receipts VALUES(?,?,?)", (path, attempt_id, error))
            if added.rowcount:
                project_id = db.execute("SELECT project_id FROM attempts WHERE id=?", (attempt_id,)).fetchone()[0]
                self._event(db, project_id, "receipt.rejected", {"attemptId": attempt_id, "path": path, "error": error})

    def finish_cancellation(self, operation_id, error=None):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            result = json.loads(
                db.execute("SELECT result FROM command_results WHERE id=?", (operation_id,)).fetchone()[0]
            )
            note = "Cancellation requested; late results remain collectable"
            if error is not None:
                note = "Cancellation delivery is unconfirmed: " + error + ". Retry Cancel request to confirm delivery."
            result["note"] = note
            db.execute(
                "UPDATE effects SET state=? WHERE operation_id=?",
                ("uncertain" if error is not None else "done", operation_id),
            )
            db.execute("UPDATE command_results SET result=? WHERE id=?", (encode(result), operation_id))
            db.execute(
                "UPDATE attempts SET error=? WHERE id=? AND status='cancel_requested'",
                (note if error is not None else None, result["attemptId"]),
            )
            project_id = db.execute("SELECT project_id FROM attempts WHERE id=?", (result["attemptId"],)).fetchone()[0]
            self._event(
                db,
                project_id,
                "cancellation.observed",
                {"operationId": operation_id, "attemptId": result["attemptId"], "note": note},
            )
        return result

    def accept_execution(self, attempt_id, execution_id, submission_id, receipt):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            packed = self._dump(db, receipt, receipt=True)
            old = db.execute("SELECT * FROM executions WHERE id=?", (execution_id,)).fetchone()
            if old:
                if old["attempt_id"] != attempt_id or old["receipt"] != packed:
                    raise Conflict("Execution identity already contains different evidence")
                return bool(old["accepted"])
            attempt = db.execute("SELECT * FROM attempts WHERE id=?", (attempt_id,)).fetchone()
            winner = attempt["status"] != attempts.COMPLETE
            db.execute(
                "INSERT INTO executions VALUES(?,?,?,?,?)",
                (execution_id, attempt_id, submission_id, packed, int(winner)),
            )
            if winner:
                self.transition(
                    attempt_id,
                    attempts.COMPLETE,
                    result=receipt,
                    db=db,
                    expected=attempt["status"],
                    recovery=True,
                )
            self._event(
                db,
                attempt["project_id"],
                "execution.collected",
                {"attemptId": attempt_id, "executionId": execution_id, "accepted": winner},
            )
        return winner

    def export_project(self, project_id):
        project = self.get(project_id)
        media_ids = {m["id"] for m in ledger.media_records(project["document"])}
        versions = {c["workflowVersion"] for c in project["document"]["clips"] if c.get("workflowVersion")}
        with self.reading() as db:
            evidence = {
                r["media_id"]: self._load(r["evidence"], db, media="resolve")
                for r in db.execute("SELECT media_id,evidence FROM media_evidence WHERE project_id=?", (project_id,))
                if r["media_id"] in media_ids
            }
        # A downloaded project carries its evidence so it stays portable; the
        # working document is what every other reader sees.
        for record in ledger.media_records(project["document"]):
            if record.get("evidence") and record["id"] not in evidence:
                evidence[record["id"]] = {
                    k: v for k, v in self.evidence(project_id, record["id"]).items() if k != "mediaId"
                }
        document = ledger.compose(project["document"], evidence, in_place=True)
        return {
            "spoolVersion": EXPORT_VERSION,
            "document": document,
            "recipes": {v: self.workflow(v) for v in versions},
        }

    def import_project(self, value):
        validate_import(value)
        document = ledger.authored(ledger.detach_for_import(value.get("document", value)))
        recipes = value.get("recipes", {})
        project_id, revision = uid(), 0
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for clip in document["clips"]:
                version = clip.get("workflowVersion")
                if version and version in recipes:
                    validate_capture(recipes[version])
                    self._capture_clip(db, project_id, clip, recipes[version], clip.get("inputValues", {}))
                    revision += 1
            document = self._write_document(db, project_id, document)
            db.execute("INSERT INTO projects VALUES(?,?,?)", (project_id, revision, self._dump(db, document)))
        return self.get(project_id)

    def intent(self, project_id, clip, request):
        with self.connect() as db:
            attempt_id = self._intent(db, project_id, clip, request, attempts.INTENT)
        return self.attempt(attempt_id)

    def _intent(self, db, project_id, clip, request, status):
        attempt_id, take_id, prompt_id = uid(), uid(), uid()
        request = copy.deepcopy(request)
        existing = db.execute(
            "SELECT count(*) FROM attempts WHERE project_id=? AND clip_id=?", (project_id, clip["id"])
        ).fetchone()[0]
        baseline = max((t.get("number", 0) for t in clip.get("takes", []) if not t.get("generated")), default=0)
        request["takeNumber"] = baseline + existing + 1
        request.update(
            {
                "attemptId": attempt_id,
                "takeId": take_id,
                "promptId": prompt_id,
                "projectId": project_id,
                "clipId": clip["id"],
                "clipName": clip["name"],
                "clipRevision": clip.get("revision", 1),
            }
        )
        request["fingerprint"] = fingerprint(request)
        db.execute(
            "INSERT INTO attempts(id,project_id,clip_id,take_id,prompt_id,status,request,result,error,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                attempt_id,
                project_id,
                clip["id"],
                take_id,
                prompt_id,
                status,
                self._dump(db, request),
                None,
                None,
                time.time(),
            ),
        )
        return attempt_id

    def operation(self, operation_id, project_id, payload):
        with self.reading() as db:
            self._check_tombstone(db, operation_id)
            row = db.execute("SELECT * FROM operations WHERE id=?", (operation_id,)).fetchone()
        if row is None:
            return None
        if row["project_id"] != project_id or row["digest"] != fingerprint(payload):
            raise OperationConflict("This operation ID already belongs to a different request")
        return json.loads(row["attempt_ids"])

    def accept_queue(self, operation_id, project_id, revision, payload, requests, actor):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._check_tombstone(db, operation_id)
            row = db.execute("SELECT * FROM operations WHERE id=?", (operation_id,)).fetchone()
            if row:
                if row["project_id"] != project_id or row["digest"] != fingerprint(payload):
                    raise OperationConflict("This operation ID already belongs to a different request")
                return json.loads(row["attempt_ids"])
            current = db.execute("SELECT revision FROM projects WHERE id=?", (project_id,)).fetchone()
            if not current:
                raise NotFound("Project not found")
            if current[0] != revision:
                raise Conflict("Project changed while preparing generation; reload before queueing")
            scope = payload.get("command", {}).get("scope", payload.get("scope", {}))
            if scope.get("maxConcurrent") is not None:
                limit = scope["maxConcurrent"]
                if type(limit) is not int or limit < 1:
                    raise ValueError("Concurrency limit must be a positive integer")
                active = db.execute(
                    "SELECT count(*) FROM attempts WHERE project_id=? AND status NOT IN ('complete','failed','cancelled')",
                    (project_id,),
                ).fetchone()[0]
                if active + len(requests) > limit:
                    raise ValueError("Queue exceeds the declared outstanding-job limit")
            identities = [self._intent(db, project_id, clip, request, attempts.WAITING) for clip, request in requests]
            db.execute(
                "INSERT INTO operations VALUES(?,?,?,?,?,?,?)",
                (
                    operation_id,
                    project_id,
                    fingerprint(payload),
                    encode(payload),
                    encode(identities),
                    actor,
                    time.time(),
                ),
            )
            if payload.get("experiment"):
                db.execute(
                    "INSERT INTO experiments VALUES(?,?,?)",
                    (
                        operation_id,
                        project_id,
                        encode({**payload["experiment"], "attemptIds": identities, "actor": actor}),
                    ),
                )
            self._event(
                db,
                project_id,
                "queue.accepted",
                {"operationId": operation_id, "attemptIds": identities, "actor": actor},
            )
        return identities

    def claim(self, attempt_id, session_id):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute(
                "UPDATE attempts SET status=? WHERE id=? AND status IN (?,?)",
                (attempts.DISPATCHING, attempt_id, attempts.INTENT, attempts.WAITING),
            )
            if changed.rowcount != 1:
                return False
            db.execute("INSERT INTO attempt_owners VALUES(?,?,?)", (attempt_id, session_id, time.time()))
            return True

    def owner(self, attempt_id):
        with self.reading() as db:
            row = db.execute("SELECT session_id FROM attempt_owners WHERE attempt_id=?", (attempt_id,)).fetchone()
        return row[0] if row else None

    def publish_host(self, configuration, session_id, definitions=None):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT * FROM host WHERE id=1").fetchone()
            if old and json.loads(old["configuration"]) != configuration:
                raise Conflict(
                    "This store is paired to another Comfy address or media folders. Use a different store or explicitly re-pair it."
                )
            schemas = encode(definitions) if definitions is not None else old["definitions"] if old else "{}"
            db.execute(
                "INSERT INTO host VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id,heartbeat=excluded.heartbeat,definitions=excluded.definitions",
                (encode(configuration), session_id, time.time(), schemas),
            )

    def host(self, include_definitions=True):
        with self.reading() as db:
            columns = "*" if include_definitions else "configuration,session_id,heartbeat"
            row = db.execute("SELECT " + columns + " FROM host WHERE id=1").fetchone()
        if not row:
            return {"connected": False, "configuration": None, "definitions": {}, "sessionId": None}
        return {
            "connected": time.time() - row["heartbeat"] < 10,
            "configuration": json.loads(row["configuration"]),
            "definitions": json.loads(row["definitions"]) if include_definitions else {},
            "sessionId": row["session_id"],
            "heartbeat": row["heartbeat"],
        }

    def retire_host(self, session_id):
        with self.connect() as db:
            db.execute("UPDATE host SET heartbeat=0 WHERE session_id=?", (session_id,))

    def _event(self, db, project_id, kind, data):
        db.execute(
            "INSERT INTO events(project_id,kind,data,created) VALUES(?,?,?,?)",
            (project_id, kind, encode(data), time.time()),
        )

    def events(self, project_id, since=0, limit=100, latest=False):
        if type(since) is not int or since < 0 or type(limit) is not int or not 1 <= limit <= 500:
            raise ValueError("Choose a nonnegative event cursor and a limit of 1-500")
        with self.reading() as db:
            order = "DESC" if latest else "ASC"
            rows = db.execute(
                "SELECT * FROM events WHERE project_id=? AND cursor>? ORDER BY cursor " + order + " LIMIT ?",
                (project_id, since, limit),
            ).fetchall()
            if latest:
                rows.reverse()
        values = [
            {"cursor": r["cursor"], "kind": r["kind"], "data": json.loads(r["data"]), "created": r["created"]}
            for r in rows
        ]
        return {"events": values, "cursor": values[-1]["cursor"] if values else since}

    def command(self, identity, project_id, revision, payload, apply):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._check_tombstone(db, identity)
            old = db.execute("SELECT * FROM operations WHERE id=?", (identity,)).fetchone()
            if old:
                if old["project_id"] != project_id or old["digest"] != fingerprint(payload):
                    raise OperationConflict("Operation ID already contains another command")
                return json.loads(
                    db.execute("SELECT result FROM command_results WHERE id=?", (identity,)).fetchone()[0]
                )
            row = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
            if not row or row["revision"] != revision:
                raise Conflict("Project changed; inspect the current revision before applying this command")
            document = self._load(row["document"], db)
            result, edited = apply(db, document)
            if edited:
                Edit(self, db, project_id, revision, document).save()
            result = {**result, "operationId": identity, "revision": revision + int(edited)}
            db.execute(
                "INSERT INTO operations VALUES(?,?,?,?,?,?,?)",
                (identity, project_id, fingerprint(payload), encode(payload), "[]", payload["actor"], time.time()),
            )
            db.execute("INSERT INTO command_results VALUES(?,?)", (identity, encode(result)))
            self._event(
                db,
                project_id,
                "command." + payload["action"],
                {
                    "operationId": identity,
                    "actor": payload["actor"],
                    "arguments": payload["arguments"],
                    "result": result,
                },
            )
        return result

    def publish_focus(self, project_id, view_id, value):
        if not isinstance(view_id, str) or not 1 <= len(view_id) <= 100:
            raise ValueError("Supply a view identity")
        clip_id = value.get("clipId") or None
        with self.connect() as db:
            row = db.execute(
                "SELECT CASE WHEN ? IS NULL THEN 1 ELSE EXISTS (SELECT 1 FROM json_each(projects.document,'$.clips') WHERE json_extract(value,'$.id')=?) END FROM projects WHERE id=?",
                (clip_id, clip_id, project_id),
            ).fetchone()
        if row is None:
            raise NotFound("Project not found")
        if not row[0]:
            raise ValueError("Focus points to an unavailable shot")
        with self.focus_store.connect() as db:
            db.execute(
                "INSERT INTO focus VALUES(?,?,?,?) ON CONFLICT(project_id,view_id) DO UPDATE SET document=excluded.document,updated=excluded.updated",
                (project_id, view_id, encode(value), time.time()),
            )

    def focused(self, project_id, view_id=None):
        with self.focus_store.connect() as db:
            rows = db.execute(
                "SELECT * FROM focus WHERE project_id=? AND updated>?", (project_id, time.time() - 15)
            ).fetchall()
        if view_id:
            rows = [r for r in rows if r["view_id"] == view_id]
        if len(rows) != 1:
            raise Conflict("Focus is stale or ambiguous; supply a current view ID or explicit shot ID")
        return {"viewId": rows[0]["view_id"], **json.loads(rows[0]["document"]), "updated": rows[0]["updated"]}

    def attempt(self, attempt_id):
        with self.reading() as db:
            row = db.execute("SELECT * FROM attempts WHERE id=?", (attempt_id,)).fetchone()
        if not row:
            raise NotFound("Attempt not found")
        result = self._attempt_row(None, row)
        result["request"] = json.loads(result["request"])
        return result

    def pending(self):
        with self.reading() as db:
            return [
                r[0]
                for r in db.execute(
                    "SELECT id FROM attempts WHERE status IN (" + ",".join("?" for _ in attempts.PENDING) + ")",
                    tuple(attempts.PENDING),
                )
            ]

    def dispatched(self, attempt_id, payload, validation):
        with self.connect() as db:
            db.execute(
                "INSERT INTO dispatches VALUES(?,?,?)", (attempt_id, self._dump(db, payload), encode(validation))
            )

    def dispatch_record(self, attempt_id):
        with self.reading() as db:
            row = db.execute("SELECT * FROM dispatches WHERE attempt_id=?", (attempt_id,)).fetchone()
        return {"payload": self._load(row["payload"]), "validation": json.loads(row["validation"])} if row else None

    def transition(self, attempt_id, status, result=None, error=None, db=None, *, expected=None, recovery=False):
        """Apply an allowed observation only if its snapshot is still current.

        Verified receipt acceptance explicitly opts into recovery. Pass db to
        join a transaction already open on this store.
        """
        if db is None:
            with self.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                return self.transition(attempt_id, status, result, error, db, expected=expected, recovery=recovery)
        current = db.execute("SELECT status,error,finished_at FROM attempts WHERE id=?", (attempt_id,)).fetchone()
        if not current or (expected is not None and current["status"] != expected):
            return False
        allowed = (
            status == attempts.COMPLETE and current[0] in attempts.RECOVERY
            if recovery
            else status == current[0] or status in attempts.ALLOWED.get(current[0], ())
        )
        if current[0] == attempts.COMPLETE or not allowed:
            return False
        if current and current["status"] == status and result is None and current["error"] == error:
            return True
        db.execute(
            "UPDATE attempts SET status=?,result=COALESCE(?,result),error=?,finished_at=? WHERE id=? AND status!='complete'",
            (
                status,
                self._dump(db, result, receipt=True) if result is not None else None,
                error,
                (current["finished_at"] if status == current["status"] else time.time())
                if status in attempts.TERMINAL
                else None,
                attempt_id,
            ),
        )
        if current and current[0] != status and current[0] != attempts.COMPLETE:
            project_id = db.execute("SELECT project_id FROM attempts WHERE id=?", (attempt_id,)).fetchone()[0]
            self._event(db, project_id, "attempt.status", {"attemptId": attempt_id, "status": status, "error": error})
        return True
