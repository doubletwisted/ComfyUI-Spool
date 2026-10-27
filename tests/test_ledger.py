import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool import ledger

CASES = json.loads((Path(__file__).parent / 'fixtures/ledger_cases.json').read_text(encoding='utf-8'))


class LedgerTests(unittest.TestCase):
    def test_interpretation_exposes_all_frames_and_recalculates_legacy_trims_once(self):
        media = {'id': 'video', 'kind': 'video', 'fps': '25/1', 'sequenceFps': 30, 'frames': 150, 'sourceFrameCount': '125', 'duration': 5, 'file': 'old-proxy.mp4', 'review': {'fps': 30}}
        document = {'fps': 30, 'clips': [{'id': 'shot', 'in': 0, 'out': 150, 'takeId': 'take', 'takes': [{'id': 'take', 'media': media}]}, {'id': 'next', 'in': 0, 'out': 30, 'takes': []}], 'media': [], 'audioClips': []}
        projected = ledger.attach(copy.deepcopy(document), [])
        self.assertEqual(projected['clips'][0]['takes'][0]['media']['frames'], 125)
        self.assertEqual(projected['clips'][0]['out'], 125)
        self.assertNotIn('gapBefore', projected['clips'][1])
        self.assertEqual(ledger.attach(copy.deepcopy(projected), []), projected)
        projected['clips'][0]['takes'][0]['media'] = copy.deepcopy(media)
        self.assertEqual(ledger.attach(projected, [])['clips'][0]['out'], 125)
        self.assertEqual(document['clips'][0]['out'], 150)

    def test_legacy_shot_offsets_convert_to_native_frame_indices(self):
        media = {'id': 'shot', 'kind': 'video', 'fps': '30/1', 'sequenceFps': 24, 'frames': 24, 'sourceRange': {'start': 48, 'frames': 24}, 'duration': 1}
        document = {'fps': 24, 'clips': [], 'media': [media]}
        ledger.attach(document, [])
        self.assertEqual(media['sourceRange'], {'start': 60, 'frames': 30})
        self.assertEqual((media['frames'], media['duration']), (30, 1.25))

    def test_editor_projection_removes_repeated_evidence_without_changing_stored_results(self):
        graph = {"nodes": [{"id": 1}], "extra": {"seed": 2**63}}
        evidence = {"probe": {"tags": {"workflow": graph}}, "workflow": graph}
        record = {"id": "render", "kind": "video", "originalFile": "output/take.mp4", **evidence}
        capture = {"workflow": graph, "prompt": {"seed": 2**63}}
        take = {"id": "take", "generated": True, "media": record, "artifacts": [record], "request": {"attemptId": "attempt", "capture": capture}, "workflowSnapshot": capture}
        project = {"id": "project", "revision": 5, "document": {"clips": [{"id": "clip", "takes": [take]}], "jobs": [{"id": "attempt", "status": "complete"}]}, "recipes": {"recipe": capture}}
        original = copy.deepcopy(project)
        compact = ledger.editor_project(project)
        held = compact["document"]["clips"][0]["takes"][0]
        self.assertNotIn("workflowSnapshot", held)
        self.assertEqual(held["request"]["capture"], capture)
        self.assertEqual(held["media"]["evidence"], ["probe", "workflow"])
        self.assertTrue(held["media"]["embeddedGraph"])
        for media in [held["media"], *held["artifacts"]]:
            self.assertNotIn("probe", media)
            self.assertNotIn("workflow", media)
            self.assertEqual(media["originalFile"], record["originalFile"])
        portable = ledger.compose(compact["document"], {"render": evidence})
        self.assertEqual(portable["clips"][0]["takes"][0]["media"], record)
        self.assertEqual(compact["document"]["jobs"], project["document"]["jobs"])
        self.assertEqual(compact["recipes"], project["recipes"])
        self.assertEqual(project, original)

    def test_permanently_deleted_results_remain_in_execution_history_without_reappearing_as_takes(self):
        case = CASES['cases'][0]
        attempts = [{**row, 'request': json.dumps(row['request']), 'result': json.dumps(row['result'])} for row in case['attempts']]
        document = copy.deepcopy(case['authored'])
        document['deletedTakeIds'] = [row['take_id'] for row in attempts]
        attached = ledger.attach(document, attempts)
        self.assertFalse(any(t.get('generated') for c in attached['clips'] for t in c['takes']))
        self.assertEqual(len(attached['jobs']), len(attempts))
        self.assertFalse(attached.get('recoverableResults'))

    def test_attachment_authored_round_trip_and_import(self):
        for case in CASES['cases']:
            with self.subTest(case=case['name']):
                rows = [{**row, 'request': json.dumps(row['request']), 'result': json.dumps(row['result'])} for row in case['attempts']]
                attached = ledger.attach(copy.deepcopy(case['authored']), rows)
                self.assertEqual(attached, case['attached'])
                self.assertEqual(ledger.authored(attached), case['authored'])
                self.assertEqual(ledger.detach_for_import(attached), case['detached'])
                self.assertEqual(case['attached'], attached)

    def test_specific_take_source_survives_another_selected_take_without_inheriting_other_results(self):
        case = CASES['cases'][0]
        attempts = [{**row, 'request': json.dumps(row['request']), 'result': json.dumps(row['result'])} for row in case['attempts']]
        wanted = attempts[0]['take_id']
        document = {'clips': [{'id': 'promoted', 'takeId': 'later-take', 'takeSourceTakeIds': [wanted], 'takes': []}]}
        attached = ledger.attach(copy.deepcopy(document), attempts)
        self.assertEqual([t['id'] for t in attached['clips'][0]['takes']], [wanted])
        self.assertEqual(ledger.authored(attached), document)
        self.assertTrue(ledger.owns(document['clips'][0], attempts[0]))
        self.assertFalse(ledger.owns(document['clips'][0], {**attempts[0], 'take_id': 'unrelated'}))

    def test_view_fields_are_not_authored_and_clip_ids_are_unique(self):
        document = copy.deepcopy(CASES['cases'][0]['authored'])
        for key in ledger.VIEW_KEYS:
            document[key] = 'local view'
        self.assertEqual(ledger.authored(document), CASES['cases'][0]['authored'])
        document['clips'].append(copy.deepcopy(document['clips'][0]))
        with self.assertRaisesRegex(ValueError, 'Clip IDs must be unique'):
            ledger.authored(document)

    def test_job_projects_target_with_the_other_request_metadata(self):
        attempt = CASES['cases'][0]['attempts'][0]
        for target in ('local', 'deadline'):
            request = {**attempt['request'], 'target': target}
            self.assertEqual(ledger.job(attempt, request)['target'], target)
        self.assertEqual(ledger.job(attempt, attempt['request'])['target'], 'local')


class DocumentFieldTests(unittest.TestCase):
    def test_field_registry_matches_the_editor_fixture(self):
        fields = json.loads((Path(__file__).parent / "fixtures" / "document_fields.json").read_text(encoding="utf-8"))
        self.assertEqual(list(ledger.EDIT_FIELDS), fields["edit"])
        self.assertEqual(list(ledger.RECORD_FIELDS), fields["records"])
        self.assertEqual(list(ledger.VIEW_FIELDS), fields["view"])
        self.assertEqual(list(ledger.SERVER_OWNED), fields["serverOwned"])
        self.assertEqual(set(ledger.VIEW_KEYS), set(fields["view"]) | set(fields["serverOwned"]))


if __name__ == '__main__':
    unittest.main()
