import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import notifier  # noqa: E402

NOW = 1_700_000_000_000
MIN = 60_000
SETTINGS = notifier.normalize_settings({}, env={})


def bins(**fills):
    return {k: {"fillLevel": v, "location": f"Loc {k}"} for k, v in fills.items()}


class DecideAlerts(unittest.TestCase):
    def test_first_alert_when_state_missing(self):
        due, upd = notifier.decide_alerts(bins(a=95), {}, SETTINGS, NOW)
        self.assertEqual([b["id"] for b in due], ["a"])
        self.assertEqual(upd, {})

    def test_exactly_at_threshold(self):
        due, _ = notifier.decide_alerts(bins(a=90, b=89.9), None, SETTINGS, NOW)
        self.assertEqual([b["id"] for b in due], ["a"])

    def test_disarmed_bin_does_not_realert(self):
        st = {"a": {"armed": False, "lastNotifiedAt": NOW - 999 * MIN}}
        due, upd = notifier.decide_alerts(bins(a=99), st, SETTINGS, NOW)
        self.assertEqual(due, [])
        self.assertEqual(upd, {})

    def test_rearm_below_threshold(self):
        st = {"a": {"armed": False, "lastNotifiedAt": NOW - MIN}}
        due, upd = notifier.decide_alerts(bins(a=74), st, SETTINGS, NOW)
        self.assertEqual(due, [])
        self.assertTrue(upd["a"]["armed"])

    def test_no_rearm_between_levels(self):
        st = {"a": {"armed": False}}
        _, upd = notifier.decide_alerts(bins(a=75), st, SETTINGS, NOW)
        self.assertEqual(upd, {})

    def test_min_interval_respected(self):
        st = {"a": {"armed": True, "lastNotifiedAt": NOW - 29 * MIN}}
        due, _ = notifier.decide_alerts(bins(a=95), st, SETTINGS, NOW)
        self.assertEqual(due, [])
        st["a"]["lastNotifiedAt"] = NOW - 30 * MIN
        due, _ = notifier.decide_alerts(bins(a=95), st, SETTINGS, NOW)
        self.assertEqual(len(due), 1)

    def test_bad_fill_values_ignored(self):
        data = {k: {"fillLevel": v} for k, v in
                dict(a=None, b="99", c=True, d=float("nan"), e=150, f=-5).items()}
        data["g"] = "not a dict"
        due, upd = notifier.decide_alerts(data, {}, SETTINGS, NOW)
        self.assertEqual((due, upd), ([], {}))

    def test_missing_fill_key(self):
        due, _ = notifier.decide_alerts({"a": {"location": "x"}}, {}, SETTINGS, NOW)
        self.assertEqual(due, [])

    def test_mark_sent_disarms(self):
        due, _ = notifier.decide_alerts(bins(a=95), {}, SETTINGS, NOW)
        st = notifier.mark_sent({}, due, NOW)
        self.assertEqual(st["a"], {"armed": False, "lastNotifiedAt": NOW, "lastFill": 95.0})


class Settings(unittest.TestCase):
    def test_defaults(self):
        s = notifier.normalize_settings(None, env={})
        self.assertEqual(s, {"enabled": True, "recipients": [], "criticalAt": 90.0,
                             "rearmBelow": 75.0, "minIntervalMinutes": 30.0})

    def test_partial_and_bad_values(self):
        s = notifier.normalize_settings(
            {"enabled": "yes", "criticalAt": "x", "rearmBelow": 95, "minIntervalMinutes": -1}, env={})
        self.assertTrue(s["enabled"])
        self.assertEqual(s["criticalAt"], 90.0)
        self.assertEqual(s["rearmBelow"], 90.0)  # clamped to criticalAt
        self.assertEqual(s["minIntervalMinutes"], 30.0)

    def test_invalid_emails_dropped_and_deduped(self):
        with self.assertLogs("smartwaste.notifier", "WARNING"):
            s = notifier.normalize_settings(
                {"recipients": ["a@x.com", "bad", "a@x.com", 5, " b@y.org "]}, env={})
        self.assertEqual(s["recipients"], ["a@x.com", "b@y.org"])

    def test_env_fallback(self):
        s = notifier.normalize_settings({"recipients": []}, env={"ALERT_TO": "o@x.com, nope ,p@x.com"})
        self.assertEqual(s["recipients"], ["o@x.com", "p@x.com"])

    def test_settings_recipients_beat_env(self):
        s = notifier.normalize_settings({"recipients": ["a@x.com"]}, env={"ALERT_TO": "o@x.com"})
        self.assertEqual(s["recipients"], ["a@x.com"])

    def test_firebase_dict_recipients(self):
        s = notifier.normalize_settings({"recipients": {"0": "a@x.com", "2": "b@x.com"}}, env={})
        self.assertEqual(s["recipients"], ["a@x.com", "b@x.com"])

    def test_env_file_parser_real_env_wins(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, ".env")
            with open(path, "w") as fh:
                fh.write("# c\nA=1\nB='two words'\nexport C=3\nA2=x=y\n\nbad line\n")
            env = {"A": "real"}
            self.assertTrue(notifier.load_env_file(path, env))
            self.assertEqual(env, {"A": "real", "B": "two words", "C": "3", "A2": "x=y"})
            self.assertFalse(notifier.load_env_file(os.path.join(d, "none"), {}))

    def test_smtp_config_defaults(self):
        c = notifier.smtp_config_from_env({"SMTP_USER": "u@x.com", "SMTP_PASSWORD": "pw"})
        self.assertEqual((c.host, c.port, c.security, c.sender), ("smtp.gmail.com", 587, "starttls", "u@x.com"))
        self.assertTrue(c.configured)
        self.assertNotIn("pw", repr(c))
        self.assertFalse(notifier.smtp_config_from_env({}).configured)


DUE = [{"id": "a", "location": "Library", "fillLevel": 95.0, "prediction": "Critical Now"},
       {"id": "b", "location": "<script>x</script>", "fillLevel": 91.5, "prediction": "Full in 2 hours"}]


class BuildMessage(unittest.TestCase):
    def test_parts_headers_and_escape(self):
        msg = notifier.build_message(DUE, ["a@x.com", "b@x.com"], "SmartWaste <s@x.com>",
                                     {"trucksAllocated": 1, "routeDistanceKm": 3.2},
                                     "https://dash.example/?a=1&b=2")
        self.assertEqual(msg["Subject"], "SmartWaste: 2 bins are full and need collection")
        self.assertEqual(msg["To"], "a@x.com, b@x.com")
        self.assertTrue(msg["Message-ID"].endswith("@x.com>"))
        self.assertTrue(msg["Date"])
        self.assertEqual(msg.get_content_type(), "multipart/alternative")
        plain = msg.get_body(("plain",)).get_content()
        page = msg.get_body(("html",)).get_content()
        self.assertIn("Library", plain)
        self.assertIn("1 truck, 3.2 km route", plain)
        self.assertNotIn("<script>", page)
        self.assertIn("&lt;script&gt;x&lt;/script&gt;", page)
        self.assertIn("a=1&amp;b=2", page)
        self.assertIn("#B0E454", page)

    def test_singular_subject_and_no_link(self):
        msg = notifier.build_message(DUE[:1], ["a@x.com"], "s@x.com")
        self.assertEqual(msg["Subject"], "SmartWaste: 1 bin is full and needs collection")
        self.assertNotIn("dashboard", msg.get_body(("plain",)).get_content().lower())
        self.assertNotIn("<a ", msg.get_body(("html",)).get_content())

    def test_test_message_is_labelled(self):
        msg = notifier.build_test_message(["a@x.com"], "s@x.com")
        self.assertIn("TEST", msg["Subject"])


CFG = notifier.SmtpConfig(user="u@x.com", password="s3cret-pw", sender="u@x.com")


class SendMessage(unittest.TestCase):
    def setUp(self):
        self.msg = notifier.build_message(DUE, ["a@x.com"], "u@x.com")

    @mock.patch("notifier.smtplib.SMTP")
    def test_starttls_login_send(self, smtp):
        notifier.send_message(self.msg, CFG)
        srv = smtp.return_value
        smtp.assert_called_once_with("smtp.gmail.com", 587, timeout=20)
        srv.starttls.assert_called_once()
        self.assertIn("context", srv.starttls.call_args.kwargs)
        srv.login.assert_called_once_with("u@x.com", "s3cret-pw")
        srv.send_message.assert_called_once_with(self.msg)
        srv.close.assert_called_once()

    @mock.patch("notifier.smtplib.SMTP_SSL")
    def test_ssl(self, ssl_cls):
        cfg = notifier.SmtpConfig(port=465, user="u@x.com", password="pw", security="ssl")
        notifier.send_message(self.msg, cfg)
        self.assertEqual(ssl_cls.call_args.kwargs["timeout"], 20)
        self.assertIn("context", ssl_cls.call_args.kwargs)
        ssl_cls.return_value.login.assert_called_once()
        ssl_cls.return_value.send_message.assert_called_once()

    @mock.patch("notifier.smtplib.SMTP")
    def test_none_security_skips_starttls(self, smtp):
        cfg = notifier.SmtpConfig(user="u", password="pw", security="none")
        notifier.send_message(self.msg, cfg)
        smtp.return_value.starttls.assert_not_called()

    @mock.patch("notifier.smtplib.SMTP")
    def test_failure_does_not_leak_password_and_closes(self, smtp):
        srv = smtp.return_value
        srv.login.side_effect = Exception("auth failed for s3cret-pw")
        with self.assertRaises(notifier.SendError) as cm:
            notifier.send_message(self.msg, CFG)
        self.assertNotIn("s3cret-pw", str(cm.exception))
        srv.close.assert_called_once()

    def test_unconfigured_raises(self):
        with self.assertRaisesRegex(notifier.SendError, "SMTP is not configured"):
            notifier.send_message(self.msg, notifier.SmtpConfig())


class ProcessAlerts(unittest.TestCase):
    def run_it(self, settings=None, config=CFG, sender=None, states=None, dry=False):
        sender = sender or mock.Mock()
        out = notifier.process_alerts(
            bins(a=95), states or {}, {"recipients": ["a@x.com"]} if settings is None else settings, config,
            now=NOW, sender=sender, dry_run=dry, env={})
        return out, sender

    def test_success_disarms_and_logs(self):
        out, sender = self.run_it()
        sender.assert_called_once()
        self.assertFalse(out.state_updates["a"]["armed"])
        self.assertEqual(out.log_entry["status"], "sent")
        self.assertEqual(out.log_entry["at"], NOW)
        self.assertEqual(out.log_entry["binIds"], ["a"])

    def test_failure_keeps_armed(self):
        out, _ = self.run_it(sender=mock.Mock(side_effect=notifier.SendError("boom s3cret-pw")))
        self.assertNotIn("a", out.state_updates)
        self.assertEqual(out.log_entry["status"], "failed")
        self.assertNotIn("s3cret-pw", out.log_entry["error"])

    def test_unconfigured_logs_failed(self):
        with self.assertLogs("smartwaste.notifier", "ERROR") as cm:
            out, sender = self.run_it(config=notifier.SmtpConfig())
        self.assertIn(".env.example", cm.output[0])
        sender.assert_not_called()
        self.assertEqual(out.log_entry["error"], "SMTP is not configured")
        self.assertEqual(out.log_entry["status"], "failed")

    def test_disabled_and_no_recipients_skipped(self):
        out, sender = self.run_it(settings={"enabled": False, "recipients": ["a@x.com"]})
        self.assertEqual(out.log_entry["status"], "skipped")
        out, _ = self.run_it(settings={})
        self.assertEqual(out.log_entry["status"], "skipped")
        sender.assert_not_called()

    def test_nothing_due_logs_nothing(self):
        out = notifier.process_alerts(bins(a=10), {}, {}, CFG, now=NOW, env={})
        self.assertIsNone(out.log_entry)

    def test_dry_run_sends_and_writes_nothing(self):
        with mock.patch("builtins.print") as pr:
            out, sender = self.run_it(dry=True)
        sender.assert_not_called()
        self.assertEqual(out.state_updates, {})
        self.assertIsNone(out.log_entry)
        self.assertIn("a@x.com", str(pr.call_args_list))

    def test_test_email(self):
        sender = mock.Mock()
        entry = notifier.send_test_email(["a@x.com"], CFG, now=NOW, sender=sender)
        sender.assert_called_once()
        self.assertEqual((entry["type"], entry["status"]), ("test", "sent"))


if __name__ == "__main__":
    unittest.main()
