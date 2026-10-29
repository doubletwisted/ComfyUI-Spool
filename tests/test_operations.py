import unittest

from spool import operations


def document(*clips, **extra):
    return {"clips": [dict(c) for c in clips], **extra}


class TakeChoiceTests(unittest.TestCase):
    def test_shorter_take_leaves_a_gap_before_the_next_clip_on_its_track(self):
        doc = document({"id": "a", "in": 10, "out": 60}, {"id": "b", "in": 0, "out": 30, "gapBefore": 2})
        operations.choose_take(doc, doc["clips"][0], "short", 20)
        self.assertEqual((doc["clips"][0]["in"], doc["clips"][0]["out"]), (0, 20))
        self.assertEqual(doc["clips"][0]["takeId"], "short")
        self.assertEqual(doc["clips"][1]["gapBefore"], 32)

    def test_last_clip_on_v1_extends_the_tail_gap(self):
        doc = document({"id": "a", "in": 0, "out": 48}, tailGap=4)
        operations.choose_take(doc, doc["clips"][0], "short", 24)
        self.assertEqual(doc["tailGap"], 28)

    def test_last_clip_on_another_track_extends_that_tracks_tail(self):
        doc = document({"id": "v1", "in": 0, "out": 48}, {"id": "v2", "in": 0, "out": 48, "videoTrack": 2})
        operations.choose_take(doc, doc["clips"][1], "short", 12)
        self.assertEqual(doc["videoTailGaps"], {"2": 36})
        self.assertNotIn("tailGap", doc)

    def test_following_clips_on_other_tracks_are_not_the_neighbour(self):
        doc = document({"id": "a", "in": 0, "out": 48}, {"id": "v2", "in": 0, "out": 10, "videoTrack": 2})
        operations.choose_take(doc, doc["clips"][0], "short", 40)
        self.assertNotIn("gapBefore", doc["clips"][1])
        self.assertEqual(doc["tailGap"], 8)

    def test_a_long_enough_take_keeps_the_trim(self):
        doc = document({"id": "a", "in": 30, "out": 60}, {"id": "b", "in": 0, "out": 10})
        operations.choose_take(doc, doc["clips"][0], "long", 200)
        self.assertEqual((doc["clips"][0]["in"], doc["clips"][0]["out"]), (30, 60))
        self.assertNotIn("gapBefore", doc["clips"][1])

    def test_a_late_in_point_moves_back_inside_the_take(self):
        doc = document({"id": "a", "in": 90, "out": 110})
        operations.choose_take(doc, doc["clips"][0], "medium", 100)
        self.assertEqual((doc["clips"][0]["in"], doc["clips"][0]["out"]), (80, 100))


class WorkflowAssignmentTests(unittest.TestCase):
    capture = {
        "prompt": {"1": {"class_type": "LoadImage", "inputs": {"image": "example.png", "seed": 7}}},
        "bindings": [
            {"key": "image", "nodeId": "1", "input": "image", "asset": True},
            {"key": "seed", "nodeId": "1", "input": "seed"},
        ],
    }

    def stale_clip(self):
        return {
            "id": "a",
            "workflow": "old-library",
            "workflowVersion": "old",
            "executionTarget": "cloud",
            "seedKey": "old-seed",
            "seedMode": "increment",
            "shotInputs": [{"key": "image", "source": "selected"}],
            "generationBase": {"takeId": "t"},
            "inputValues": {"old": 1},
        }

    def test_assignment_resets_what_belonged_to_the_previous_workflow(self):
        clip = self.stale_clip()
        operations.assign_workflow(clip, "new", self.capture)
        self.assertEqual(clip["workflowVersion"], "new")
        self.assertEqual(clip["inputValues"], {"image": "example.png", "seed": 7})
        self.assertEqual(clip["executionTarget"], "local")
        self.assertEqual(clip["seedMode"], "same")
        for key in ("seedKey", "shotInputs", "generationBase", "workflow"):
            self.assertNotIn(key, clip)

    def test_cloud_recipes_run_on_cloud_and_built_ins_ask_for_their_own_sources(self):
        clip = self.stale_clip()
        capture = {
            **self.capture,
            "executionTarget": "cloud",
            "provenance": {"builtinTemplate": "api_example", "importedWorkflowId": "library-1"},
        }
        operations.assign_workflow(clip, "cloud", capture)
        self.assertEqual(clip["executionTarget"], "cloud")
        self.assertEqual(clip["inputValues"]["image"], "")
        self.assertEqual(clip["workflow"], "library-1")


class RestageTests(unittest.TestCase):
    def test_values_that_still_name_the_captured_source_follow_its_staged_copy(self):
        original = {
            "prompt": {"1": {"inputs": {"image": "photo.png", "seed": 5}}},
            "bindings": [
                {"key": "image", "nodeId": "1", "input": "image", "asset": True},
                {"key": "seed", "nodeId": "1", "input": "seed"},
            ],
        }
        prepared = {"prompt": {"1": {"inputs": {"image": "spool-projects/p/input/images/photo-1a2b.png", "seed": 5}}}}
        values = {"image": "photo.png", "seed": 5}
        operations.restage(original, prepared, values)
        self.assertEqual(values, {"image": "spool-projects/p/input/images/photo-1a2b.png", "seed": 5})
        chosen = {"image": "another.png"}
        operations.restage(original, prepared, chosen)
        self.assertEqual(chosen, {"image": "another.png"}, "A source the user changed is kept")


if __name__ == "__main__":
    unittest.main()
