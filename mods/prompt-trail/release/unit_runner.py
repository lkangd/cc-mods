"""Runs the unittest modules from tests/ and prints each test's outcome as JSON,
so the release verdict can cite tests by id. The verbose log goes to stderr.
Exits non-zero unless every test passed: a failure, an error or a skip.

With no module names it runs MODULES, the one list that verify-startup.sh and
the release gate (release_evidence.py) both run."""
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULES = ["artifact_static", "bridge_protocol", "helper_protocol", "project_root", "release_verdict"]


class _Collect(unittest.TextTestResult):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.outcomes: dict[str, str] = {}

    def addSuccess(self, test) -> None:
        super().addSuccess(test)
        self.outcomes.setdefault(test.id(), "pass")

    def addFailure(self, test, err) -> None:
        super().addFailure(test, err)
        self.outcomes[test.id()] = "fail"

    def addError(self, test, err) -> None:
        super().addError(test, err)
        self.outcomes[test.id()] = "fail"

    def addSkip(self, test, reason) -> None:
        super().addSkip(test, reason)
        self.outcomes[test.id()] = "skip"

    def addExpectedFailure(self, test, err) -> None:
        super().addExpectedFailure(test, err)
        self.outcomes[test.id()] = "fail"

    def addUnexpectedSuccess(self, test) -> None:
        super().addUnexpectedSuccess(test)
        self.outcomes[test.id()] = "fail"

    def addSubTest(self, test, subtest, err) -> None:
        super().addSubTest(test, subtest, err)
        if err is not None:
            self.outcomes[test.id()] = "fail"


def main() -> int:
    sys.path.insert(0, str(ROOT / "tests"))
    suite = unittest.TestSuite(
        unittest.defaultTestLoader.loadTestsFromName(name) for name in sys.argv[1:] or MODULES
    )
    runner = unittest.TextTestRunner(stream=sys.stderr, verbosity=2, resultclass=_Collect)
    result = runner.run(suite)
    print(json.dumps(result.outcomes))
    passed = result.wasSuccessful() and all(outcome == "pass" for outcome in result.outcomes.values())
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
