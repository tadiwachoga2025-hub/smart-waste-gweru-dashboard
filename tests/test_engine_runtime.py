"""Runtime guarantees for the continuous engine (no Firebase connection).

These cover the parts that keep the service alive in production: writable data
paths, a local heartbeat even when Firebase is down, and SIGTERM acceptance.
"""
import json
import os
import signal
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import engine  # noqa: E402


class RuntimePaths(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(engine._stop_reset)

    def test_data_dir_honours_env_and_creates_it(self):
        path = os.path.join(self.tmp.name, "state", "nested")
        with mock.patch.dict(os.environ, {"ENGINE_DATA_DIR": path}):
            self.assertEqual(engine._data_dir(), path)
            self.assertTrue(os.path.isdir(path))

    def test_heartbeat_file_honours_env(self):
        path = os.path.join(self.tmp.name, "beat.json")
        with mock.patch.dict(os.environ, {"ENGINE_HEARTBEAT_FILE": path}):
            self.assertEqual(engine._heartbeat_path(), path)

    def test_heartbeat_defaults_to_data_dir(self):
        with mock.patch.dict(os.environ, {"ENGINE_DATA_DIR": self.tmp.name,
                                          "ENGINE_HEARTBEAT_FILE": ""}):
            os.environ.pop("ENGINE_HEARTBEAT_FILE", None)
            path = engine._heartbeat_path()
        self.assertEqual(path, os.path.join(self.tmp.name, engine.HEARTBEAT_FILENAME))

    def test_local_heartbeat_survives_firebase_failure(self):
        path = os.path.join(self.tmp.name, "beat.json")
        with mock.patch.dict(os.environ, {"ENGINE_HEARTBEAT_FILE": path}), \
                mock.patch.object(engine.db, "reference", side_effect=RuntimeError("offline")):
            engine.write_heartbeat("live", {"binsSeen": 2})
        self.assertTrue(os.path.exists(path))
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
        self.assertEqual(payload["state"], "live")
        self.assertEqual(payload["engine"], engine.ENGINE_VERSION)
        self.assertEqual(payload["metrics"], {"binsSeen": 2})

    def test_inline_credentials_are_accepted(self):
        info = {"type": "service_account", "project_id": "demo"}
        with mock.patch.object(engine.firebase_admin, "_apps", {}), \
                mock.patch.dict(os.environ, {"FIREBASE_CREDENTIALS": json.dumps(info)}), \
                mock.patch.object(engine.credentials, "Certificate") as cert, \
                mock.patch.object(engine.firebase_admin, "initialize_app") as init:
            engine.init_firebase()
        cert.assert_called_once_with(info)
        init.assert_called_once()

    def test_inline_credentials_must_be_json(self):
        with mock.patch.object(engine.firebase_admin, "_apps", {}), \
                mock.patch.dict(os.environ, {"FIREBASE_CREDENTIALS": "{not json"}):
            with self.assertRaisesRegex(RuntimeError, "not valid JSON"):
                engine.init_firebase()

    def test_sigterm_sets_stop_flag(self):
        engine._stop_reset()
        engine.install_signal_handlers()
        os.kill(os.getpid(), signal.SIGTERM)
        self.assertTrue(engine._stop)

    def test_sleep_is_interrupted_by_stop(self):
        engine._stop = True
        start = engine.time.time()
        engine._sleep(10)
        self.assertLess(engine.time.time() - start, 2)


if __name__ == "__main__":
    unittest.main()
