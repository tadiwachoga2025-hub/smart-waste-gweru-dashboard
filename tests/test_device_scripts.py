"""Unit tests for the ESP32 device tooling.

These stay offline: they cover the request shape that prevents the two 401s
(no device profile, and an Authorization header instead of ?auth=).
"""
import io
import json
import os
import stat
import sys
import tempfile
import time
import unittest
from argparse import Namespace
from contextlib import redirect_stdout
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import device_credentials  # noqa: E402
import device_reading  # noqa: E402


class PayloadTests(unittest.TestCase):
    def test_payload_has_epoch_milliseconds_and_reading(self):
        before = int(time.time() * 1000)
        payload = device_reading.build_payload(Namespace(fill=63, battery=None, rssi=None))
        after = int(time.time() * 1000)
        self.assertEqual(payload["fillLevel"], 63)
        self.assertGreaterEqual(payload["lastUpdated"], before)
        self.assertLessEqual(payload["lastUpdated"], after)
        self.assertNotIn("battery", payload)
        self.assertNotIn("rssi", payload)

    def test_optional_diagnostics_are_kept(self):
        payload = device_reading.build_payload(Namespace(fill=12, battery=88, rssi=-61))
        self.assertEqual(payload["battery"], 88)
        self.assertEqual(payload["rssi"], -61)


class RequestTests(unittest.TestCase):
    def test_reading_url_uses_query_string_auth(self):
        url = device_reading.reading_url("bin 1", "tok")
        self.assertIn("/bins/bin%201.json", url)
        self.assertIn("?auth=tok", url)
        self.assertNotIn("Authorization", url)

    def test_show_request_never_recommends_bearer_auth(self):
        out = io.StringIO()
        with redirect_stdout(out):
            device_reading.show_request("bin1", {"fillLevel": 63}, "<idToken>")
        text = out.getvalue()
        self.assertTrue(text.startswith("PATCH "))
        self.assertIn("?auth=<idToken>", text)
        self.assertIn("Do NOT send 'Authorization: Bearer", text)


class CredentialsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "device-credentials.local")
        patcher = mock.patch.object(device_credentials, "CREDS_FILE", self.path)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_write_then_read_round_trip_with_mode_600(self):
        device_credentials.write({"email": "device@example.test", "password": "secret"})
        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o600)
        self.assertEqual(
            device_credentials.read(),
            {"email": "device@example.test", "password": "secret"},
        )

    def test_read_accepts_the_human_header(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write(device_credentials.HEADER)
            fh.write(json.dumps({"email": "device@example.test"}))
        self.assertEqual(device_credentials.read()["email"], "device@example.test")

    def test_missing_file_returns_none(self):
        self.assertIsNone(device_credentials.read())

    def test_invalid_json_returns_none(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("header\n{not json")
        self.assertIsNone(device_credentials.read())


if __name__ == "__main__":
    unittest.main()
