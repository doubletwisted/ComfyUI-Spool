"""Native workflow parsing and synthetic media timing; no demo imports or user media."""
import array
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool.cuts import detect_cuts, scene_scores
from spool.interchange import timecode_frames
from spool.media import Media, _probe
from spool.workflows import parse_import, workflow_document, workflow_metadata

FFMPEG, FFPROBE = shutil.which('ffmpeg'), shutil.which('ffprobe')
GRAPH = {'version': 0.4, 'nodes': [{'id': 1, 'type': 'CustomNode', 'widgets_values': ['żółć 🧵', 123]}], 'links': []}
PROMPT = {'1': {'class_type': 'CustomNode', 'inputs': {'text': 'żółć 🧵', 'seed': 9223372036854775807}}}


class WorkflowTests(unittest.TestCase):
    def test_raw_direct_wrapper_prompt_and_provenance(self):
        for value, graph, prompt in [(GRAPH, GRAPH, None), (PROMPT, PROMPT, PROMPT),
                                     ({'workflow': json.dumps(GRAPH), 'prompt': json.dumps(PROMPT)}, GRAPH, PROMPT)]:
            with self.subTest(value=value):
                raw = json.dumps(value, ensure_ascii=False) + '\n'
                record = parse_import(raw, 'żółć.json')
                self.assertTrue(record['id'].startswith('workflow-'))
                self.assertEqual(record['name'], 'żółć.json')
                self.assertEqual(record['data']['workflow'], graph)
                self.assertEqual(record['data']['prompt'], prompt)
                self.assertEqual(record['data']['provenance']['originalText'], raw)
                self.assertEqual(record['data']['provenance']['originalDocument'], value)

    def test_workflow_rejects_arbitrary_or_malformed_json(self):
        for value in [{'project': 'Spool', 'clips': []}, {'nodes': ['not a node']}, {'1': {'inputs': {}}}, '{broken']:
            self.assertIsNone(workflow_document(value))
            with self.assertRaises(ValueError):
                parse_import(json.dumps(value), 'bad.json')

    def test_direct_uppercase_stream_and_vhs_metadata(self):
        for probe in [{'format': {'tags': {'workflow': json.dumps(GRAPH), 'prompt': json.dumps(PROMPT)}}},
                      {'streams': [{'tags': {'WORKFLOW': json.dumps(GRAPH), 'PROMPT': json.dumps(PROMPT)}}]},
                      {'format': {'tags': {'comment': json.dumps({'workflow': GRAPH, 'prompt': json.dumps(PROMPT)})}}},
                      {'streams': [{'tags': {'COMMENT': json.dumps({'extra_pnginfo': {'workflow': GRAPH}, 'prompt': PROMPT})}}]}]:
            with self.subTest(probe=probe):
                metadata = workflow_metadata(probe)
                self.assertEqual(metadata['workflow'], GRAPH)
                self.assertEqual(metadata['prompt'], PROMPT)

    def test_prompt_only_bad_metadata_and_plain_footage(self):
        self.assertEqual(workflow_metadata({'format': {'tags': {'prompt': json.dumps(PROMPT)}}})['workflow'], PROMPT)
        bad = workflow_metadata({'format': {'tags': {'workflow': '{broken'}}})
        self.assertIn('workflowWarning', bad)
        self.assertNotIn('workflow', bad)
        self.assertEqual(workflow_metadata({'format': {'tags': {'comment': 'ordinary footage'}}}), {})

    def test_missing_ffprobe_fails_with_actionable_error(self):
        with patch('spool.media.find_tool', return_value=None), self.assertRaisesRegex(ValueError, 'Install ffprobe'):
            _probe('unused.mp4')


class CutTests(unittest.TestCase):
    def test_isolated_spikes_are_cuts_and_busy_motion_is_not(self):
        scores = [0.004] * 120
        scores[30] = 0.06  # dark shot change: low absolute score, isolated
        scores[60:64] = [0.3, 0.35, 0.32, 0.3]  # whip pan: high but sustained
        scores[90], scores[92] = 0.5, 0.2  # flash right after a cut keeps only the stronger frame
        self.assertEqual(detect_cuts(scores, 30), [30, 90])

    def test_cuts_keep_half_a_second_from_the_ends(self):
        scores = [0.004] * 60
        scores[5] = scores[57] = 0.5
        self.assertEqual(detect_cuts(scores, 24), [])


class CutCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='spool-cut-cache-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.video = self.root / 'review.mp4'
        self.tool = self.root / 'ffmpeg.exe'
        self.video.write_bytes(b'video')
        self.tool.write_bytes(b'tool')
        self.cache = self.root / 'previews' / 'cut-scores'
        output = subprocess.CompletedProcess([], 0, stdout='frame:0 pts:0\nlavfi.scene_score=0.000000\nframe:2 pts:2\nlavfi.scene_score=0.500000\n')
        run = patch('spool.cuts.subprocess.run', return_value=output)
        self.run = run.start()
        self.addCleanup(run.stop)

    def scores(self):
        return scene_scores(str(self.tool), self.video, self.cache)

    def test_persisted_scores_reuse_and_rebuild_after_eviction(self):
        self.assertEqual(self.scores(), [0, 0, .5])
        self.assertEqual(self.scores(), [0, 0, .5])
        self.assertEqual(self.run.call_count, 1)
        self.assertEqual(list(self.cache.glob('*.partial')), [])
        next(self.cache.glob('*.json')).unlink()
        self.assertEqual(self.scores(), [0, 0, .5])
        self.assertEqual(self.run.call_count, 2)

    def test_source_path_size_timestamp_tool_and_version_invalidate(self):
        self.scores()
        self.video.write_bytes(b'longer video')
        self.scores()
        stamp = self.video.stat().st_mtime_ns
        os.utime(self.video, ns=(stamp + 1000000, stamp + 1000000))
        self.scores()
        other = self.root / 'another.mp4'
        shutil.copy2(self.video, other)
        scene_scores(str(self.tool), other, self.cache)
        self.tool.write_bytes(b'new ffmpeg version')
        self.scores()
        stamp = self.tool.stat().st_mtime_ns
        os.utime(self.tool, ns=(stamp + 1000000, stamp + 1000000))
        self.scores()
        with patch('spool.cuts.SCORE_VERSION', 2):
            self.scores()
        self.assertEqual(self.run.call_count, 7)

    def test_damaged_or_invalid_scores_are_rebuilt(self):
        self.scores()
        cache = next(self.cache.glob('*.json'))
        stored = json.loads(cache.read_text())
        bad = ['{truncated', '[]', json.dumps({**stored, 'source': []})]
        bad += [json.dumps({**stored, 'scores': scores}) for scores in [None, [True], [-1], [1.1], [float('nan')], [float('inf')], ['0.5']]]
        for content in bad:
            with self.subTest(content=content):
                cache.write_text(content)
                before = self.run.call_count
                self.assertEqual(self.scores(), [0, 0, .5])
                self.assertEqual(self.run.call_count, before + 1)
                self.assertEqual(json.loads(cache.read_text())['scores'], [0, 0, .5])

    def test_failed_scan_does_not_publish_and_retry_works(self):
        self.run.side_effect = subprocess.CalledProcessError(1, ['ffmpeg'])
        with self.assertRaises(subprocess.CalledProcessError):
            self.scores()
        self.assertFalse(self.cache.exists())
        self.run.side_effect = None
        self.assertEqual(self.scores(), [0, 0, .5])

    def test_changing_source_during_scan_does_not_publish(self):
        def changed(*args, **kwargs):
            self.video.write_bytes(b'replaced during scan')
            return self.run.return_value
        self.run.side_effect = changed
        with self.assertRaisesRegex(ValueError, 'Video changed'):
            self.scores()
        self.assertFalse(self.cache.exists())

    def test_unwritable_cache_is_optional_and_atomic_write_failure_cleans_up(self):
        with patch('spool.cuts.Path.replace', side_effect=PermissionError('busy')):
            self.assertEqual(self.scores(), [0, 0, .5])
        self.assertEqual(list(self.cache.iterdir()), [])
        with patch('spool.cuts.Path.mkdir', side_effect=PermissionError('read only')):
            self.assertEqual(self.scores(), [0, 0, .5])
        self.assertEqual(self.scores(), [0, 0, .5])
        self.assertEqual(self.run.call_count, 3)


@unittest.skipUnless(FFMPEG and FFPROBE, 'ffmpeg and ffprobe are required')
class MediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='spool-native-media-')
        cls.root = Path(cls.temp.name).resolve()
        cls.media = Media(cls.root, cls.root, cls.root, cls.root)
        cls.tone = cls.root / 'tone.wav'
        with wave.open(str(cls.tone), 'wb') as output:
            output.setparams((1, 2, 48000, 0, 'NONE', 'not compressed'))
            output.writeframes(b''.join(struct.pack('<h', round(6000 * math.sin(2 * math.pi * 440 * i / 48000))) for i in range(96000)))
        cls.still = cls.root / 'black.png'
        Image.new('RGB', (2, 2)).save(cls.still)
        cls.video = cls.root / 'av.mp4'
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x36:r=24:d=2', '-i', str(cls.tone),
                        '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(cls.video)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def export(self, **values):
        result = self.media.export({'clips': [{'file': 'black.png', 'in': 0, 'out': 48}], **values})
        path = self.media.resolve(result['url'].removeprefix('/spool/media/'))
        return path, _probe(path)['streams']

    def test_shot_bake_uses_original_time_range_and_cfr_at_another_rate(self):
        original = self.root / 'three-colors.mp4'
        inputs = [arg for color in ('red', 'lime', 'blue') for arg in ('-f', 'lavfi', '-i', f'color=c={color}:s=64x36:r=30:d=1')]
        subprocess.run([FFMPEG, '-v', 'error', '-y', *inputs, '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(original)], check=True)
        metadata = {'id': 'shot', 'kind': 'video', 'file': 'missing-review.mp4', 'originalFile': 'three-colors.mp4', 'frames': 24, 'sequenceFps': 24, 'sourceRange': {'start': 24}}
        baked = self.media.bake_shot(metadata, 6, 18, 24, 'video')
        output = self.root / baked['file']; video = next(s for s in _probe(output)['streams'] if s['codec_type'] == 'video')
        self.assertEqual((video['width'], video['height'], int(video['nb_frames']), video['avg_frame_rate']), (64, 36, 12, '24/1'))
        self.assertEqual(baked['settings']['offsetSeconds'], 1)
        pixels = subprocess.run([FFMPEG, '-v', 'error', '-i', str(output), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
        self.assertGreater(pixels[1], pixels[0] + 100)
        stamp = output.stat().st_mtime_ns
        self.assertEqual(self.media.bake_shot(metadata, 6, 18, 24, 'video')['file'], baked['file'])
        self.assertEqual(output.stat().st_mtime_ns, stamp)
        frame = self.media.bake_shot(metadata, 6, 18, 24, 'firstFrame')
        with Image.open(self.root / frame['file']) as image:
            self.assertEqual(image.size, (64, 36))
            self.assertGreater(image.getpixel((0, 0))[1], 200)

    def test_shot_bake_preserves_audio_only_when_requested(self):
        metadata = {'id': 'av', 'kind': 'video', 'file': 'missing-review.mp4', 'originalFile': 'av.mp4', 'frames': 48, 'sequenceFps': 24}
        for audio in (False, True):
            result = self.media.bake_shot(metadata, 12, 24, 24, 'video', audio=audio)
            probe = _probe(self.root / result['file'])
            self.assertEqual(any(s['codec_type'] == 'audio' for s in probe['streams']), audio)
            self.assertAlmostEqual(float(probe['format']['duration']), .5, delta=.07)

    def test_playback_cache_uses_original_and_shares_shots(self):
        first = {'kind': 'video', 'file': 'missing-review.mp4', 'originalFile': 'av.mp4', 'sourceRange': {'start': 0}}
        second = {**first, 'sourceRange': {'start': 12}}
        full = self.media.preview(first, 128, 72, 24)
        path = self.media.resolve(full['file'])
        stamp = path.stat().st_mtime_ns
        cached = self.media.preview(second, 128, 72, 24)
        self.assertEqual(cached['file'], full['file'])
        self.assertEqual(cached['offset'], .5)
        self.assertEqual(path.stat().st_mtime_ns, stamp)
        video = next(s for s in _probe(path)['streams'] if s['codec_type'] == 'video')
        self.assertEqual((video['width'], video['height'], int(video['nb_frames'])), (128, 72, 48))
        half = self.media.preview(first, 64, 36, 24)
        self.assertNotEqual(full['file'], half['file'])
        self.assertEqual(_probe(self.media.resolve(half['file']))['streams'][0]['width'], 64)
        conformed = self.media.preview(first, 64, 36, 30)
        self.assertEqual(int(_probe(self.media.resolve(conformed['file']))['streams'][0]['nb_frames']), 48)

    def test_playback_image_preserves_transparency_and_timeline_canvas(self):
        source = self.root / 'transparent.png'
        Image.new('RGBA', (8, 4), (20, 90, 170, 128)).save(source)
        metadata = {'kind': 'image', 'file': source.name, 'originalFile': source.name}
        result = self.media.preview(metadata, 16, 16, 24)
        with Image.open(self.media.resolve(result['file'])) as image:
            self.assertEqual(image.size, (16, 16))
            pixel = image.getpixel((8, 8))
            self.assertEqual(pixel[3], 128)
            self.assertTrue(all(abs(a - b) <= 1 for a, b in zip(pixel[:3], (20, 90, 170))))
            self.assertEqual(image.getpixel((8, 0)), (0, 0, 0, 0))
        old = result['file']
        Image.new('RGBA', (8, 4), (255, 0, 0, 255)).save(source)
        self.assertNotEqual(self.media.preview(metadata, 16, 16, 24)['file'], old)

    def samples(self, path):
        result = subprocess.run([FFMPEG, '-v', 'error', '-i', str(path), '-map', '0:a:0', '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'], capture_output=True, check=True)
        samples = array.array('f')
        samples.frombytes(result.stdout)
        return samples

    def test_generation_audio_alignment_trim_padding_levels_and_fades(self):
        metadata = {'id': 'tone', 'kind': 'audio', 'file': 'tone.wav', 'frames': 48}
        segments = [{'media': metadata, 'in': 0, 'out': 24, 'start': 12, 'audio': {'gainDb': -6, 'fadeIn': 6, 'fadeOut': 6}}]
        baked = self.media.bake_audio(segments, 24, 48)
        path = self.root / baked['file']; samples = self.samples(path)
        self.assertEqual(len(samples), 96000)
        self.assertLess(self.rms(samples, 0, .45), .0001)
        self.assertLess(self.rms(samples, 1.6, 1.95), .0001)
        level = self.rms(samples, .8, 1.1)
        self.assertAlmostEqual(level, 6000 / 32768 / math.sqrt(2) * 10 ** (-6 / 20), delta=.002)
        self.assertLess(self.rms(samples, .51, .56), level * .3)
        self.assertLess(self.rms(samples, 1.44, 1.49), level * .3)
        stamp = path.stat().st_mtime_ns
        self.assertEqual(self.media.bake_audio(segments, 24, 48)['file'], baked['file'])
        self.assertEqual(path.stat().st_mtime_ns, stamp)
        cropped = self.media.bake_audio([{**segments[0], 'start': -18}], 24, 24)
        samples = self.samples(self.root / cropped['file'])
        self.assertGreater(self.rms(samples, .01, .04), level * .75)
        self.assertLess(self.rms(samples, .21, .24), level * .2)
        self.assertLess(self.rms(samples, .3, .9), .0001)

    def test_generation_audio_uses_original_video_range_and_handles_silence(self):
        metadata = {'id': 'av', 'kind': 'video', 'file': 'missing-review.mp4', 'originalFile': 'av.mp4', 'sequenceFps': 24, 'sourceRange': {'start': 24}}
        baked = self.media.bake_audio([{'media': metadata, 'in': 6, 'out': 18, 'start': 0}], 24, 24)
        self.assertEqual(baked['settings']['sources'][0]['offsetSeconds'], 1.25)
        samples = self.samples(self.root / baked['file'])
        self.assertGreater(self.rms(samples, .05, .4), .1)
        self.assertLess(self.rms(samples, .6, .9), .0001)
        silent = self.media.bake_audio([], 24, 24)
        self.assertLess(self.rms(self.samples(self.root / silent['file']), .05, .95), .0001)

    def rms(self, samples, start, end):
        section = samples[round(start * 48000):round(end * 48000)]
        return math.sqrt(sum(x * x for x in section) / len(section))

    def test_delayed_level_and_fades_have_exact_sequence_timing(self):
        path, streams = self.export(audioClips=[{'file': 'tone.wav', 'in': 0, 'out': 24, 'start': 12, 'gainDb': -6, 'fadeIn': 6, 'fadeOut': 6}])
        video, audio = streams
        self.assertEqual(int(video['nb_frames']), 48)
        self.assertAlmostEqual(float(video['duration']), 2, places=5)
        self.assertAlmostEqual(float(audio['duration']), 2, places=5)
        self.assertEqual(float(audio['start_time']), 0)
        samples = self.samples(path)
        self.assertLess(self.rms(samples, 0, .4), .0001)
        level = self.rms(samples, .85, 1.1)
        self.assertAlmostEqual(level, 6000 / 32768 / math.sqrt(2) * 10 ** (-6 / 20), delta=.004)
        self.assertLess(self.rms(samples, .52, .58), level * .35)
        self.assertLess(self.rms(samples, 1.4, 1.45), level * .4)
        self.assertLess(self.rms(samples, 1.7, 1.9), .0001)

    def test_muted_clip_and_disabled_audio(self):
        path, _ = self.export(audioClips=[{'file': 'tone.wav', 'in': 0, 'out': 48, 'start': 0, 'muted': True}])
        self.assertLess(self.rms(self.samples(path), .2, 1.8), .0001)
        _, streams = self.export(audio=False)
        self.assertEqual([s['codec_type'] for s in streams], ['video'])
        self.assertEqual(int(streams[0]['nb_frames']), 48)

    def test_export_range_keeps_audio_phase_fades_and_exact_duration(self):
        layer = {'file': 'tone.wav', 'in': 0, 'out': 48, 'start': 0, 'fadeIn': 24, 'fadeOut': 24}
        full, _ = self.export(audioClips=[layer])
        cropped, streams = self.export(clips=[{'file': 'black.png', 'in': 0, 'out': 24}], audioClips=[layer], audioOffset=12)
        self.assertEqual(int(streams[0]['nb_frames']), 24)
        self.assertAlmostEqual(float(streams[0]['duration']), 1, places=5)
        self.assertAlmostEqual(float(streams[1]['duration']), 1, places=5)
        self.assertEqual(float(streams[1]['start_time']), 0)
        original, selected = self.samples(full), self.samples(cropped)
        for start in [.05, .3, .65, .85]:
            self.assertAlmostEqual(self.rms(selected, start, start+.08), self.rms(original, start+.5, start+.58), delta=.003)

    def test_mix_keeps_levels_instead_of_normalizing_layers(self):
        layer = {'file': 'tone.wav', 'in': 0, 'out': 24, 'start': 0}
        path, _ = self.export(audioClips=[layer, layer])
        self.assertAlmostEqual(self.rms(self.samples(path), .2, .8), 2 * 6000 / 32768 / math.sqrt(2), delta=.007)

    def test_legacy_linked_audio_alignment_across_black_gap(self):
        clip = {'file': 'av.mp4', 'in': 6, 'out': 12}
        path, streams = self.export(clips=[clip, {'file': 'black.png', 'in': 0, 'out': 12}, clip])
        self.assertEqual(int(streams[0]['nb_frames']), 24)
        self.assertAlmostEqual(float(streams[1]['duration']), 1, places=5)
        samples = self.samples(path)
        self.assertGreater(self.rms(samples, .05, .2), .1)
        self.assertLess(self.rms(samples, .35, .65), .0001)
        self.assertGreater(self.rms(samples, .8, .95), .1)

    def test_timeline_export_references_originals_with_offsets_rates_and_timecode(self):
        original = self.root / 'timecoded.mp4'
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x36:r=30:d=2', '-timecode', '01:00:00:00',
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(original)], check=True)
        metadata = [{'id': 'shot', 'kind': 'video', 'file': 'shot-review.mp4', 'originalFile': str(original), 'fps': '30/1', 'sourceRange': {'start': 15}},
                    {'id': 'av', 'kind': 'video', 'file': 'av-review.mp4', 'originalFile': 'av.mp4', 'fps': '24/1'}]
        plan = {'duration': 60, 'fps': 24, 'width': 64, 'height': 36, 'name': 'QA cut', 'tracks': [
            {'kind': 'video', 'name': 'V1', 'enabled': True, 'clips': [
                {'id': 'b', 'name': 'Shot', 'file': 'shot-review.mp4', 'start': 24, 'in': 3, 'out': 15, 'enabled': False},
                {'id': 'a', 'name': 'Generated', 'file': 'av-review.mp4', 'start': 0, 'in': 6, 'out': 30, 'takeId': 'take'}]},
            {'kind': 'video', 'name': 'V2', 'enabled': False, 'clips': [{'id': 'c', 'name': 'Still', 'file': 'black.png', 'start': 12, 'in': 0, 'out': 12}]},
            {'kind': 'audio', 'name': 'A1', 'enabled': True, 'clips': [{'id': 'a', 'name': 'Generated', 'file': 'av-review.mp4', 'start': 0, 'in': 6, 'out': 30, 'gainDb': -3, 'fadeIn': 0, 'fadeOut': 4}]},
            {'kind': 'audio', 'name': 'A2', 'enabled': True, 'clips': [{'id': 'm', 'name': 'Tone', 'file': 'tone.wav', 'start': 6, 'in': 0, 'out': 24}]}]}
        result = self.media.export_timeline(plan, metadata)
        path = Path(result['path'])
        self.assertEqual((path.parent, path.suffix), (self.root / 'exports', '.otio'))
        self.assertTrue(result['filename'].startswith('QA-cut-'))
        timeline = json.loads(path.read_text(encoding='utf-8'))
        self.assertEqual(timeline, result['timeline'])
        frames = lambda t: (t['value'], t['rate'])
        v1, v2, a1, a2 = timeline['tracks']['children']
        self.assertEqual([(t['kind'], t['name'], t['enabled']) for t in (v1, v2, a1, a2)], [('Video', 'V1', True), ('Video', 'V2', False), ('Audio', 'A1', True), ('Audio', 'A2', True)])
        self.assertEqual([c['OTIO_SCHEMA'] for c in v1['children']], ['Clip.1', 'Clip.1', 'Gap.1'])
        generated, shot, tail = v1['children']
        self.assertEqual(generated['media_reference']['target_url'], str((self.root / 'av.mp4').resolve()))
        self.assertEqual((frames(generated['source_range']['start_time']), frames(generated['source_range']['duration'])), ((6, 24), (24, 24)))
        self.assertEqual((generated['effects'], generated['metadata']['spool']), ([], {'id': 'a', 'takeId': 'take'}))
        # A shot of a 30 fps source with 01:00:00:00 timecode, 15 frames in, trimmed 3 more, played one frame per sequence frame.
        self.assertEqual(shot['media_reference']['target_url'], str(original.resolve()))
        self.assertEqual(frames(shot['source_range']['start_time']), (108000 + 15 + 3, 30))
        self.assertEqual(frames(shot['source_range']['duration']), (12, 24))
        self.assertEqual(frames(shot['media_reference']['available_range']['start_time']), (108000, 30))
        self.assertEqual(frames(shot['media_reference']['available_range']['duration']), (60, 30))
        self.assertEqual([(e['OTIO_SCHEMA'], e['time_scalar']) for e in shot['effects']], [('LinearTimeWarp.1', .8)])
        self.assertFalse(shot['enabled'])
        self.assertEqual(frames(tail['source_range']['duration']), (24, 24))
        self.assertEqual([c['OTIO_SCHEMA'] for c in v2['children']], ['Gap.1', 'Clip.1'])
        self.assertIsNone(v2['children'][1]['media_reference']['available_range'])
        self.assertEqual(a1['children'][0]['metadata']['spool'], {'id': 'a', 'gainDb': -3, 'fadeIn': 0, 'fadeOut': 4})
        self.assertEqual([frames(c['source_range']['duration']) for c in a2['children']], [(6, 24), (24, 24)])
        self.assertEqual(frames(a2['children'][1]['media_reference']['available_range']['duration']), (48, 24))
        try:
            import opentimelineio as otio
        except ImportError:
            return
        loaded = otio.adapters.read_from_file(str(path))
        self.assertEqual(loaded.duration(), otio.opentime.RationalTime(60, 24))
        self.assertEqual(loaded.tracks[0].range_of_child_at_index(1).start_time, otio.opentime.RationalTime(24, 24))

    def test_timeline_export_rejects_overlaps_and_empty_timelines(self):
        clip = {'file': 'black.png', 'start': 0, 'in': 0, 'out': 12}
        with self.assertRaisesRegex(ValueError, 'Add a clip'):
            self.media.export_timeline({'tracks': [{'kind': 'video', 'clips': []}]})
        with self.assertRaisesRegex(ValueError, 'overlap'):
            self.media.export_timeline({'tracks': [{'kind': 'video', 'name': 'V1', 'clips': [clip, {**clip, 'start': 6}]}]})

    def test_source_timecode_frames(self):
        self.assertEqual(timecode_frames('01:00:00:00', 24), 86400)
        self.assertEqual(timecode_frames('00:01:00;02', 30000 / 1001), 1800)
        self.assertEqual(timecode_frames('01:00:00;00', 30000 / 1001), 107892)
        self.assertEqual(timecode_frames(None, 24), 0)

    def test_source_resolution_preserves_containment(self):
        for path in ['..', '.', '../outside.mp4', 'uploads/../../outside.mp4', '%2e%2e/outside.mp4']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.media.resolve(path)

    def test_audio_video_describe_real_proxies_and_waveforms(self):
        for source, kind in [(self.tone, 'audio'), (self.video, 'video')]:
            metadata = self.media.describe(source)
            self.assertEqual(metadata['kind'], kind)
            self.assertTrue(metadata['audio'])
            self.assertEqual(metadata['frames'], 48)
            wave_image = self.media.resolve(metadata['wave'])
            with Image.open(wave_image) as image:
                self.assertEqual(image.size, (1280, 80))
            self.assertTrue(self.media.resolve(metadata['file']).is_file())

    def test_generation_frame_rate_reinterprets_all_source_frames(self):
        source = self.root / 'generated-30fps.mp4'
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(source)], check=True)
        original = source.read_bytes()
        metadata = self.media.describe(source, fps=24)
        self.assertEqual(metadata['fps'], '30/1')
        self.assertEqual(int(metadata['sourceFrameCount']), 60)
        self.assertEqual((metadata['frames'], metadata['sequenceFps']), (60, 24))
        proxy = _probe(self.media.resolve(metadata['file']))['streams'][0]
        self.assertEqual((proxy['avg_frame_rate'], int(proxy['nb_frames'])), ('24/1', 60))
        self.assertAlmostEqual(float(proxy['duration']), 2.5, places=5)
        self.assertEqual(source.read_bytes(), original)

    def test_every_frame_survives_faster_review_baking_and_original_export(self):
        source = self.root / 'indexed-25fps.mkv'
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'nullsrc=s=64x36:r=25:d=1,geq=lum=16+N*8:cb=128:cr=128', '-f', 'lavfi', '-i', 'sine=frequency=400:duration=1', '-c:v', 'ffv1', '-c:a', 'pcm_s16le', str(source)], check=True)
        metadata = self.media.describe(source, fps=30)
        self.assertEqual((metadata['frames'], metadata['duration']), (25, 25/30))
        def pixels(path):
            value = subprocess.run([FFMPEG, '-v', 'error', '-i', str(path), '-map', '0:v', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
            probe = _probe(path)['streams'][0]
            step = probe['width']*probe['height']*3
            return [value[i+step//2] for i in range(0,len(value),step)]
        values = pixels(self.media.resolve(metadata['file']))
        self.assertEqual(len(values), 25)
        self.assertTrue(all(b > a+4 for a,b in zip(values,values[1:])), values)
        baked = self.media.bake_shot(metadata, 5, 20, 30, 'video', audio=True)
        values = pixels(self.root / baked['file'])
        self.assertEqual(len(values), 15)
        self.assertTrue(all(b > a+4 for a,b in zip(values,values[1:])), values)
        last = self.media.export_frame(metadata, 24, 30)
        with Image.open(self.root/'exports'/last['filename']) as image:
            self.assertGreater(image.getpixel((32,18))[0], 215)
        exported = self.media.export({'fps': 30, 'width': 64, 'height': 36, 'clips': [{'file': metadata['file'], 'in': 0, 'out': 25}], 'audioClips': [{'file': metadata['file'], 'in': 0, 'out': 25, 'start': 0}], 'audio': True}, [metadata])
        output = self.media.resolve(exported['url'].removeprefix('/spool/media/'))
        values = pixels(output)
        self.assertEqual(len(values), 25)
        self.assertTrue(all(b > a+4 for a,b in zip(values,values[1:])), values)
        audio = next(s for s in _probe(output)['streams'] if s['codec_type']=='audio')
        self.assertAlmostEqual(float(audio['duration']), 25/30, delta=.03)
        samples = self.samples(output)[4800:24000]
        crossings = sum(a<=0<b for a,b in zip(samples,samples[1:]))
        self.assertAlmostEqual(crossings/(len(samples)/48000),400,delta=5)
        audio_input = self.media.bake_audio([{'media':metadata,'in':5,'out':20,'start':0}],30,15)
        self.assertEqual(len(self.samples(self.root/audio_input['file'])),24000)

    def test_variable_timestamps_do_not_drop_or_repeat_source_frames(self):
        source = self.root/'variable-pts.mkv'
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=25:d=1', '-vf', "setpts='PTS+gte(N,12)*0.25/TB'", '-fps_mode', 'passthrough', '-c:v', 'ffv1', str(source)], check=True)
        metadata = self.media.describe(source, fps=30)
        self.assertEqual((metadata['frames'], metadata['sourceFrameCount']), (25,25))
        self.assertAlmostEqual(metadata['duration'], 25/30)
        baked = self.media.bake_shot(metadata, 0, 25, 30, 'video')
        self.assertEqual(int(_probe(self.root/baked['file'])['streams'][0]['nb_frames']), 25)

    def test_footage_import_splits_exact_shots_at_the_source_rate(self):
        source = self.root / 'cuts.mp4'
        colors = [('red', 40), ('blue', 25), ('green', 35)]
        inputs = [arg for color, frames in colors for arg in ('-f', 'lavfi', '-i', f'color=c={color}:s=64x36:r=30,trim=end_frame={frames}')]
        subprocess.run([FFMPEG, '-v', 'error', '-y', *inputs, '-i', str(self.tone), '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1[v]', '-map', '[v]', '-map', '3:a',
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(source)], check=True)
        result = self.media.import_footage(source)
        self.assertEqual(result['fps'], 30)
        self.assertEqual([(s['sourceRange']['start'], s['frames']) for s in result['shots']], [(0, 40), (40, 25), (65, 35)])
        for shot in result['shots']:
            self.assertEqual(int(_probe(self.media.resolve(shot['file']))['streams'][0]['nb_frames']), shot['frames'])
            self.assertFalse(shot['audio'])
            self.assertEqual(shot['originalFile'], str(source))
        self.assertEqual(result['audio']['kind'], 'audio')
        exported = self.media.export({'fps': 30, 'clips': [{'file': s['file'], 'in': 0, 'out': s['frames']} for s in result['shots']], 'audio': False})
        video = _probe(self.media.resolve(exported['url'].removeprefix('/spool/media/')))['streams'][0]
        self.assertEqual((int(video['nb_frames']), video['avg_frame_rate']), (100, '30/1'))
        whole = self.media.import_footage(source, fps=24, detect=False)
        self.assertEqual(len(whole['shots']), 1)
        self.assertEqual(whole['shots'][0]['frames'], 100)
        # Import already scanned this proxy. Trimmed requests and a newly opened
        # Media must use that raw scan, preserving cut offsets without FFmpeg.
        with patch('spool.cuts.subprocess.run', side_effect=AssertionError('repeated scan')):
            self.assertEqual(self.media.find_cuts(result['source'], 30, 10, 90), [30, 55])
            reopened = Media(self.root, self.root, self.root, self.root)
            self.assertEqual(reopened.find_cuts(result['source'], 30, 0, 100), [40, 65])
        self.assertEqual(self.media.find_cuts(result['shots'][0], 30, 0, 40), [])
        frame = self.media.export_frame(result['shots'][1], 0, 30)
        with Image.open(self.media.resolve(frame['url'].removeprefix('/spool/media/'))) as image:
            self.assertEqual(image.size, (64, 36))
            self.assertGreater(image.getpixel((32, 18))[2], 200)
        exported = self.media.export({'fps': 30, 'width': 128, 'height': 72, 'audio': False,
                                      'clips': [{'file': s['file'], 'in': 0, 'out': s['frames']} for s in result['shots']]}, result['shots'])
        output = self.media.resolve(exported['url'].removeprefix('/spool/media/'))
        video = _probe(output)['streams'][0]
        self.assertEqual((video['width'], video['height'], int(video['nb_frames'])), (128, 72, 100))
        pixels = subprocess.run([FFMPEG, '-v', 'error', '-ss', str(40 / 30), '-i', str(output), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
        self.assertGreater(pixels[(36 * 128 + 64) * 3 + 2], 200)
        with self.assertRaises(ValueError):
            self.media.export_frame(result['shots'][0], 40, 30)
        with self.assertRaisesRegex(ValueError, 'even'):
            self.media.export({'width': 127, 'height': 72, 'clips': [{'file': 'black.png', 'in': 0, 'out': 2}]})
        with self.assertRaises(ValueError):
            self.media.import_footage('cuts.mp4')

    def test_real_mp4_and_webm_tags_keep_workflow_unicode(self):
        for suffix, tags in [('.mp4', {'comment': json.dumps({'workflow': GRAPH, 'prompt': json.dumps(PROMPT)}, ensure_ascii=False)}),
                             ('.webm', {'WORKFLOW': json.dumps(GRAPH), 'PROMPT': json.dumps(PROMPT)})]:
            target = self.root / ('żółć' + suffix)
            command = [FFMPEG, '-v', 'error', '-y', '-i', str(self.video), '-t', '0.5', '-c:v', 'libvpx-vp9' if suffix == '.webm' else 'copy', '-an']
            for key, value in tags.items():
                command += ['-metadata', key + '=' + value]
            subprocess.run(command + [str(target)], check=True)
            metadata = self.media.describe(target)
            self.assertEqual(metadata['workflow'], GRAPH)
            self.assertEqual(metadata['prompt'], PROMPT)


if __name__ == '__main__':
    unittest.main()

class InputStagingTests(unittest.TestCase):
    def test_staged_names_resolve_to_the_project_file_they_came_from(self):
        from spool.media import Media, STAGED_PREFIX, staged_relative
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            media = Media(root / "project", root / "input", root / "output", root / "temp", project_id="p1")
            self.assertEqual(media.input_source(STAGED_PREFIX + "p1/input/images/a.png [input]"), (root / "project" / "input/images/a.png").resolve())
            self.assertEqual(media.input_source("plain.png"), (root / "input" / "plain.png").resolve())
            self.assertEqual(media.input_source(STAGED_PREFIX + "other/input/images/a.png"), (root / "input" / STAGED_PREFIX / "other/input/images/a.png").resolve(), "Another project's staged name stays a Comfy input")
            self.assertEqual(staged_relative(STAGED_PREFIX + "p1/input/images/a.png [input]"), "input/images/a.png")
            self.assertIsNone(staged_relative("plain.png"))

    def test_a_frozen_file_must_keep_its_size_and_hash(self):
        from spool.media import check_frozen, sha256
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "frozen.png"
            path.write_bytes(b"frozen bytes")
            asset = {"byteSize": path.stat().st_size, "sha256": sha256(path)}
            check_frozen(path, asset)
            path.write_bytes(b"frozen bytez")
            with self.assertRaisesRegex(ValueError, "changed"):
                check_frozen(path, asset)
