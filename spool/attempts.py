"""Attempts: their statuses, transitions, cancel policy and execution target.

An attempt computes on one target. Local ComfyUI attempts are dispatched and observed
by execution.py, Deadline attempts are dispatched there and observed by farm.py, and
Comfy Cloud attempts are dispatched and observed by cloud.py.
"""
LOCAL, DEADLINE, CLOUD = 'local', 'deadline', 'cloud'
TARGETS = (LOCAL, DEADLINE, CLOUD)

INTENT = 'intent'
WAITING = 'waiting_for_host'
DISPATCHING = 'dispatching'
QUEUED = 'queued'
RUNNING = 'running'
COLLECTING = 'collecting'
COLLECTION_PENDING = 'collection_pending'
COMPLETE = 'complete'
FAILED = 'failed'
UNCERTAIN = 'uncertain'
CANCELLED = 'cancelled'
SUBMITTING = 'submitting'
SUBMISSION_UNCERTAIN = 'submission_uncertain'
FARM_QUEUED = 'farm_queued'
FARM_RUNNING = 'farm_running'
FARM_ATTENTION = 'farm_attention'
CANCEL_REQUESTED = 'cancel_requested'

# ui/generation.js mirrors these sets and cancel_action; tests/fixtures/attempt_statuses.json pins both.
PENDING = frozenset({SUBMITTING, SUBMISSION_UNCERTAIN, FARM_QUEUED, FARM_RUNNING, FARM_ATTENTION, CANCEL_REQUESTED, INTENT, WAITING, DISPATCHING, QUEUED, RUNNING, COLLECTING, COLLECTION_PENDING, UNCERTAIN})
TERMINAL = frozenset({COMPLETE, FAILED, CANCELLED})

# Every pending attempt can be re-observed in queue/history or have a recoverable
# receipt read failure. These observations are not a monotonic progress counter.
OBSERVED = frozenset({SUBMITTING, SUBMISSION_UNCERTAIN, FARM_QUEUED, FARM_RUNNING, FARM_ATTENTION, CANCEL_REQUESTED, QUEUED, RUNNING, COLLECTING, COLLECTION_PENDING, FAILED, UNCERTAIN, CANCELLED})
ALLOWED = {status: OBSERVED for status in PENDING}
ALLOWED[INTENT] = OBSERVED | {DISPATCHING}
ALLOWED[WAITING] = OBSERVED | {DISPATCHING}
ALLOWED[DISPATCHING] = OBSERVED | {DISPATCHING}
ALLOWED[COLLECTING] = OBSERVED | {COMPLETE}
ALLOWED[CANCEL_REQUESTED] = OBSERVED | {CANCELLED}
ALLOWED.update({status: frozenset() for status in TERMINAL})


def target_of(request, submission=None):
    """Where an attempt computes. The frozen request records it; a Deadline submission
    row also marks Deadline work recorded before requests named their target."""
    return DEADLINE if submission else request.get('target', LOCAL)


def cancel_action(status, target, external_job=False):
    """What Cancel does: 'cancelled' at once, 'requested' from the execution target, or 'refused'.

    Unsent and local uncertain attempts have no running work to stop. A local
    uncertain attempt is absent from Comfy's queue and history, so dismissing it
    cannot drop a result. Cloud and owned Deadline jobs are asked to stop.
    """
    if status in TERMINAL:
        return 'refused'
    if status in (INTENT, WAITING) or (target == LOCAL and status == UNCERTAIN):
        return 'cancelled'
    if target == CLOUD or (target == DEADLINE and external_job):
        return 'requested'
    return 'refused'
