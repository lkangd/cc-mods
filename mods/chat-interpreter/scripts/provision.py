#!/usr/bin/env python3
"""Provision private connection values from the operator's own terminal."""

import argparse
import getpass
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import warnings


def private_input(prompt):
    # getpass otherwise falls back to visible input when there is no terminal.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        return getpass.getpass(prompt)


def private_directory(path):
    path.mkdir(mode=0o700, exist_ok=True)
    entry = path.lstat()
    if (not stat.S_ISDIR(entry.st_mode) or entry.st_uid != os.getuid()
            or entry.st_mode & 0o077):
        raise ValueError("The configuration directory must be owned by you with mode 0700.")


def provision(args):
    if os.name != "posix":
        raise ValueError("Private-file provisioning requires a POSIX terminal. A CLI can use its own credential store.")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{8,64}", args.id):
        raise ValueError("Invalid candidate ID.")
    config_dir = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    config_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    plugin_dir = config_dir / "chat-interpreter"
    private_directory(plugin_dir)
    directory = plugin_dir / "credentials"
    private_directory(directory)
    destination = directory / (args.id + ".json")
    if os.path.lexists(destination):
        raise FileExistsError

    values = {}
    if not args.endpoint_only:
        if args.from_env:
            secret = os.environ.get(args.from_env, "")
        else:
            secret = private_input("Translation credential (hidden): ")
        if not secret.strip() or any(c in secret for c in "\r\n\0"):
            raise ValueError("No usable credential was provided.")
        values["secret"] = secret
    if args.endpoint or args.endpoint_only:
        endpoint = private_input("Translation endpoint (hidden): ").strip()
        if not re.fullmatch(r"https?://[^\s/@?#\\]+(?:[/?][^\s#\\]*)?", endpoint, re.I):
            raise ValueError("Enter a valid HTTP or HTTPS endpoint without embedded credentials.")
        values["endpoint"] = endpoint

    # Publish the fully written file once. A concurrent provision cannot replace it.
    with tempfile.NamedTemporaryFile(mode="w", dir=directory, encoding="utf-8", delete=False) as pending:
        path = Path(pending.name)
        try:
            json.dump(values, pending)
            pending.flush()
            os.fsync(pending.fileno())
            os.link(path, destination)
        finally:
            path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("id", help="candidate ID supplied by setup")
    parser.add_argument("--from-env", metavar="NAME", help="read a credential from this terminal's environment")
    endpoint = parser.add_mutually_exclusive_group()
    endpoint.add_argument("--endpoint", action="store_true", help="also enter a private endpoint")
    endpoint.add_argument("--endpoint-only", action="store_true", help="enter a private endpoint without a credential")
    args = parser.parse_args()
    if args.from_env and args.endpoint_only:
        parser.error("--from-env requires a credential")
    try:
        provision(args)
    except FileExistsError:
        parser.exit(1, "This candidate is already provisioned. Create a new candidate to change its values.\n")
    except (getpass.GetPassWarning, EOFError, KeyboardInterrupt):
        parser.exit(1, "Private input requires your local interactive terminal.\n")
    except OSError:
        parser.exit(1, "Cannot save the private configuration. Check local file permissions.\n")
    except ValueError as error:
        parser.exit(1, str(error) + "\n")
    print("Private configuration is ready. Continue setup in the same session.")


if __name__ == "__main__":
    main()
