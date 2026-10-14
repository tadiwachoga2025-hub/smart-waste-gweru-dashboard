"""SMTP settings helper + precedence (settings/smtp over .env).

Covers the dashboard-manageable SMTP contract:
    settings/smtp: {host, port, sender, security, user, password, updatedAt}
Precedence lives in engine.effective_smtp_config (Firebase wins when complete,
i.e. user + password present, else .env fallback). No test touches Firebase.
"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import notifier  # noqa: E402
import engine  # noqa: E402


class SmtpConfigFromSettings(unittest.TestCase):
    def test_full_settings(self):
        cfg = notifier.smtp_config_from_settings({
            "host": "smtp.example.com",
            "port": 465,
            "sender": "Alerts <a@example.com>",
            "security": "ssl",
            "user": "a@example.com",
            "password": "pw123",
        })
        self.assertEqual(cfg.host, "smtp.example.com")
        self.assertEqual(cfg.port, 465)
        self.assertEqual(cfg.sender, "Alerts <a@example.com>")
        self.assertEqual(cfg.security, "ssl")
        self.assertTrue(cfg.configured)

    def test_defaults_mirror_env(self):
        cfg = notifier.smtp_config_from_settings({})
        env = notifier.smtp_config_from_env({})
        self.assertEqual((cfg.host, cfg.port, cfg.security), (env.host, env.port, env.security))
        self.assertFalse(cfg.configured)

    def test_non_mapping_is_empty(self):
        self.assertFalse(notifier.smtp_config_from_settings(None).configured)
        self.assertFalse(notifier.smtp_config_from_settings("nope").configured)

    def test_sender_falls_back_to_user(self):
        cfg = notifier.smtp_config_from_settings({"user": "u@x.com", "password": "pw"})
        self.assertEqual(cfg.sender, "u@x.com")

    def test_bad_port_falls_back(self):
        with self.assertLogs("smartwaste.notifier", "WARNING"):
            cfg = notifier.smtp_config_from_settings({"port": "not-a-number"})
        self.assertEqual(cfg.port, 587)
        with self.assertLogs("smartwaste.notifier", "WARNING"):
            cfg = notifier.smtp_config_from_settings({"port": True})
        self.assertEqual(cfg.port, 587)

    def test_string_port_parsed(self):
        cfg = notifier.smtp_config_from_settings({"port": "2525"})
        self.assertEqual(cfg.port, 2525)

    def test_bad_security_falls_back(self):
        with self.assertLogs("smartwaste.notifier", "WARNING"):
            cfg = notifier.smtp_config_from_settings({"security": "TLS"})
        self.assertEqual(cfg.security, "starttls")
        cfg = notifier.smtp_config_from_settings({"security": "SSL"})
        self.assertEqual(cfg.security, "ssl")

    def test_repr_never_leaks_password(self):
        cfg = notifier.smtp_config_from_settings({"user": "u@x.com", "password": "s3cret-pw"})
        self.assertNotIn("s3cret-pw", repr(cfg))
        self.assertIn("***", repr(cfg))


class Precedence(unittest.TestCase):
    def test_settings_win_when_complete(self):
        cfg = engine.effective_smtp_config(
            {"host": "smtp.settings.com", "port": 2525, "user": "s@x.com",
             "password": "pw", "security": "none"},
            env={"SMTP_HOST": "smtp.env.com", "SMTP_USER": "e@x.com",
                 "SMTP_PASSWORD": "envpw"},
        )
        self.assertEqual((cfg.host, cfg.port, cfg.user), ("smtp.settings.com", 2525, "s@x.com"))

    def test_env_fallback_when_settings_incomplete(self):
        for raw in (None, {}, {"user": "s@x.com"}, {"password": "pw"},
                    {"user": "", "password": ""}):
            cfg = engine.effective_smtp_config(
                raw, env={"SMTP_HOST": "smtp.env.com", "SMTP_USER": "e@x.com",
                          "SMTP_PASSWORD": "envpw"})
            self.assertEqual(cfg.host, "smtp.env.com", msg=f"raw={raw!r}")

    def test_env_fallback_when_settings_missing(self):
        cfg = engine.effective_smtp_config(
            None, env={"SMTP_USER": "e@x.com", "SMTP_PASSWORD": "envpw"})
        self.assertTrue(cfg.configured)

    def test_nothing_configured(self):
        self.assertFalse(engine.effective_smtp_config(None, env={}).configured)


class TestQueue(unittest.TestCase):
    """The pending queue sends via notifier.send_test_email, logs, and acks."""

    def _refs(self, stores):
        refs = {}

        class Ref:
            def __init__(self, name):
                self.name = name

            def get(self):
                return stores.get(self.name)

            def push(self, entry):
                stores.setdefault("pushes", []).append((self.name, entry))

            def update(self, patch):
                stores.setdefault("updates", []).append((self.name, patch))
                node = stores.get(self.name)
                if isinstance(node, dict):
                    node.update(patch)

        def reference(name):
            refs[name] = refs.get(name) or Ref(name)
            return refs[name]

        return reference

    def test_pending_sent_pushes_and_acks(self):
        stores = {
            "settings/smtpTest": {"status": "pending", "requestedAt": 123},
            "settings/alerts": {"recipients": ["a@x.com"]},
            "settings/smtp": {"host": "h", "port": 587, "user": "u@x.com",
                              "password": "pw", "security": "starttls"},
        }
        with mock.patch.object(engine.db, "reference", self._refs(stores)):
            with mock.patch.object(engine.notifier, "send_test_email",
                                   return_value={"at": 1, "type": "test",
                                                 "status": "sent", "binIds": [],
                                                 "binLocations": [], "recipients": ["a@x.com"],
                                                 "subject": "t"}) as send:
                engine.handle_smtp_test_queue()
        send.assert_called_once()
        args, _ = send.call_args
        self.assertEqual(args[0], ["a@x.com"])  # current normalized recipients
        self.assertEqual(stores["settings/smtpTest"]["status"], "sent")
        self.assertIn("handledAt", stores["settings/smtpTest"])
        pushes = [p for p in stores["pushes"] if p[0] == "alertLog"]
        self.assertEqual(len(pushes), 1)
        self.assertEqual(pushes[0][1]["type"], "test")

    def test_failure_maps_to_failed_with_scrubbed_result(self):
        secret = "s3cret-pw"
        stores = {
            "settings/smtpTest": {"status": "pending", "requestedAt": 123},
            "settings/alerts": {"recipients": ["a@x.com"]},
            "settings/smtp": {"user": "u@x.com", "password": secret},
        }
        entry = {"at": 1, "type": "test", "status": "failed", "binIds": [],
                 "binLocations": [], "recipients": ["a@x.com"], "subject": "t",
                 "error": f"auth {secret} bad"}
        with mock.patch.object(engine.db, "reference", self._refs(stores)):
            with mock.patch.object(engine.notifier, "send_test_email", return_value=entry):
                engine.handle_smtp_test_queue()
        self.assertEqual(stores["settings/smtpTest"]["status"], "failed")
        self.assertNotIn(secret, stores["settings/smtpTest"]["result"])
        self.assertLessEqual(len(stores["settings/smtpTest"]["result"]), 500)

    def test_non_pending_ignored(self):
        stores = {"settings/smtpTest": {"status": "sent"}}
        with mock.patch.object(engine.db, "reference", self._refs(stores)):
            with mock.patch.object(engine.notifier, "send_test_email") as send:
                engine.handle_smtp_test_queue()
        send.assert_not_called()

    def test_never_raises(self):
        with mock.patch.object(engine.db, "reference", side_effect=RuntimeError("db down")):
            engine.handle_smtp_test_queue()  # must not raise


if __name__ == "__main__":
    unittest.main()
