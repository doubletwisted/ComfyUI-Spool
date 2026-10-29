"""Stable, flat HTTP errors. Unexpected exceptions must not expose internals."""


class SpoolError(Exception):
    code = "internal_error"
    status = 500

    def __str__(self):
        return str(self.args[0]) if self.args else self.code


class NotFound(SpoolError, KeyError):
    code = "not_found"
    status = 404


class InvalidRequest(SpoolError, ValueError):
    code = "invalid_request"
    status = 400


class Forbidden(SpoolError, PermissionError):
    code = "forbidden"
    status = 403


class RevisionConflict(SpoolError, ValueError):
    code = "revision_conflict"
    status = 409


class OperationConflict(RevisionConflict):
    code = "operation_id_conflict"


class Unavailable(SpoolError):
    code = "unavailable"
    status = 503


class StudioOutdated(SpoolError):
    code = "studio_outdated"
    status = 412
