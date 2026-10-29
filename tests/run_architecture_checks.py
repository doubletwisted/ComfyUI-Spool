"""Run the architecture plan's production-module gates, stopping at a failure."""
import subprocess
import sys
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if os.name == 'nt':
    os.environ.setdefault('AIOHTTP_NOSENDFILE', '1')
commands = [[sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_native.py', '-v'],
            [sys.executable, 'tests/editor_contract_checks.py']]
commands += [['node', 'tests/' + name] for name in ['project_edit_checks.mjs', 'diagnostics_checks.mjs', 'generation_checks.mjs', 'editor_lifecycle_checks.mjs', 'profile_checks.mjs', 'capture_boundary_checks.mjs',
                                                  'video_guard_checks.mjs', 'timeline_checks.mjs', 'video_tracks_checks.mjs', 'take_review_checks.mjs', 'ledger_checks.mjs', 'history_checks.mjs', 'edit_session_checks.mjs', 'api_checks.mjs', 'pointer_checks.mjs', 'keys_checks.mjs', 'picture_checks.mjs', 'preview_checks.mjs', 'bridge_checks.mjs', 'wire_checks.mjs', 'handoff_checks.mjs', 'workflow_link_checks.mjs', 'graph_inputs_checks.mjs', 'graph_capture_checks.mjs', 'input_groups_checks.mjs']
             if (ROOT / 'tests' / name).exists()]
commands += [[sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', name, '-v']
             for name in ['test_cloud.py', 'test_credentials.py', 'test_project_folders.py', 'test_workflow_save.py', 'test_take_files.py', 'test_sidecars.py', 'test_ledger.py', 'test_media.py', 'test_workflow_inputs.py', 'test_builtin_workflows.py', 'test_take_workflow.py', 'test_wire.py', 'test_receipts.py', 'test_queue_operations.py', 'test_farm_protocol.py', 'test_deadline_job.py', 'test_deadline_contract.py', 'test_commands.py', 'test_launcher.py', 'test_system.py', 'test_executor_conflict.py', 'test_requirements.py', 'test_security.py', 'test_attempt_statuses.py', 'test_uploads.py', 'test_nonblocking.py', 'test_comfy_contract.py', 'test_operations.py', 'test_store_interface.py'] if (ROOT / 'tests' / name).exists()]
for command in commands:
    print('Running ' + ' '.join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)
