#!/usr/bin/env python3
"""Provision private connection values from the operator's own terminal."""

import argparse
import getpass
import json
import locale
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import warnings


def chinese_locale():
    lang = next((os.environ[name].strip() for name in ("LC_ALL", "LC_MESSAGES", "LANG")
                 if os.environ.get(name, "").strip()), "")
    if not lang and os.name == "nt":
        import ctypes
        lang = locale.windows_locale.get(ctypes.windll.kernel32.GetUserDefaultUILanguage(), "")
    return bool(re.match(r"^zh(?:[_\-.]|$)", lang, re.I))


def message(english, chinese):
    return chinese if chinese_locale() else english


def private_input(prompt):
    # getpass otherwise falls back to visible input when there is no terminal.
    if os.name == "nt" and not sys.stdin.isatty():
        raise EOFError
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        return getpass.getpass(prompt)


def private_windows_directory(path):
    try:
        import pywintypes
        import win32api
        import win32con
        import win32file
        import win32security as security
        import winerror
        from ntsecuritycon import FILE_ALL_ACCESS
    except ImportError:
        raise ValueError(message("Install pywin32 for this Python to provision a private Windows ACL.",
                                 "请为此 Python 安装 pywin32，以创建 Windows 专用访问控制列表。")) from None

    try:
        token = security.OpenProcessToken(win32api.GetCurrentProcess(), win32con.TOKEN_QUERY)
        sid = security.GetTokenInformation(token, security.TokenUser)[0]
        user = security.ConvertSidToStringSid(sid)
        # Protect the DACL from parent grants. The single user grant passes to children.
        attributes = security.SECURITY_ATTRIBUTES()
        attributes.SECURITY_DESCRIPTOR = security.ConvertStringSecurityDescriptorToSecurityDescriptor(
            f"O:{user}D:P(A;OICI;FA;;;{user})", 1)
        try:
            win32file.CreateDirectory(str(path), attributes)
        except pywintypes.error as error:
            if error.winerror != winerror.ERROR_ALREADY_EXISTS:
                raise
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise OSError
        descriptor = security.GetNamedSecurityInfo(str(path), security.SE_FILE_OBJECT,
                                                   security.OWNER_SECURITY_INFORMATION | security.DACL_SECURITY_INFORMATION)
        acl = descriptor.GetSecurityDescriptorDacl()
        if (descriptor.GetSecurityDescriptorOwner() != sid or acl is None or acl.GetAceCount() != 1
                or not descriptor.GetSecurityDescriptorControl()[0] & security.SE_DACL_PROTECTED):
            raise OSError
        inheritable = win32con.OBJECT_INHERIT_ACE | win32con.CONTAINER_INHERIT_ACE
        if acl.GetAce(0) != ((security.ACCESS_ALLOWED_ACE_TYPE, inheritable), FILE_ALL_ACCESS, sid):
            raise OSError
    except pywintypes.error:
        raise OSError from None


def private_directory(path):
    if os.name == "nt":
        private_windows_directory(path)
        return
    path.mkdir(mode=0o700, exist_ok=True)
    entry = path.lstat()
    if (not stat.S_ISDIR(entry.st_mode) or entry.st_uid != os.getuid()
            or entry.st_mode & 0o077):
        raise ValueError(message("The configuration directory must be owned by you with mode 0700.",
                                 "配置目录必须归你所有，权限为 0700。"))


def provision(args):
    if os.name not in ("posix", "nt"):
        raise ValueError(message("Private-file provisioning is unavailable on this platform.", "此平台不支持配置专用文件。"))
    if not re.fullmatch(r"[a-zA-Z0-9_-]{8,64}", args.id):
        raise ValueError(message("Invalid candidate ID.", "候选连接 ID 无效。"))
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
            secret = private_input(message("Translation credential (hidden): ", "翻译凭据（输入不可见）："))
        if not secret.strip() or any(c in secret for c in "\r\n\0"):
            raise ValueError(message("No usable credential was provided.", "未提供可用的凭据。"))
        values["secret"] = secret
    if args.endpoint or args.endpoint_only:
        endpoint = private_input(message("Translation endpoint (hidden): ", "翻译服务地址（输入不可见）：")).strip()
        if not re.fullmatch(r"https?://[^\s/@?#\\]+(?:[/?][^\s#\\]*)?", endpoint, re.I):
            raise ValueError(message("Enter a valid HTTP or HTTPS endpoint without embedded credentials.",
                                     "请输入有效的 HTTP 或 HTTPS 服务地址，请勿嵌入凭据。"))
        values["endpoint"] = endpoint

    # Publish the fully written file once. A concurrent provision cannot replace it.
    pending = tempfile.NamedTemporaryFile(mode="w", dir=directory, encoding="utf-8", delete=False)
    path = Path(pending.name)
    try:
        with pending:
            json.dump(values, pending)
            pending.flush()
            os.fsync(pending.fileno())
        if os.name == "nt":
            # Windows rename fails if the destination exists.
            os.rename(path, destination)
        else:
            os.link(path, destination)
    finally:
        path.unlink(missing_ok=True)


class PrivateArgumentParser(argparse.ArgumentParser):
    def error(self, unused_reason):
        # argparse's default diagnostic repeats unrecognized arguments verbatim.
        self.exit(2, message("Invalid arguments. Use --help for usage.", "参数无效。请使用 --help 查看用法。") + "\n")


def main():
    parser = PrivateArgumentParser(description=message(__doc__, "从你的终端配置翻译连接的私有信息。"))
    parser.add_argument("id", help=message("candidate ID supplied by setup", "设置过程中提供的候选连接 ID"))
    parser.add_argument("--from-env", metavar="NAME", help=message("read a credential from this terminal's environment",
                                                                   "从此终端的环境变量读取凭据"))
    endpoint = parser.add_mutually_exclusive_group()
    endpoint.add_argument("--endpoint", action="store_true", help=message("also enter a private endpoint", "同时输入私有服务地址"))
    endpoint.add_argument("--endpoint-only", action="store_true", help=message("enter a private endpoint without a credential",
                                                                               "仅输入私有服务地址"))
    args = parser.parse_args()
    if args.from_env and args.endpoint_only:
        parser.exit(2, message("--from-env requires a credential.", "--from-env 仅适用于需要凭据的连接。") + "\n")
    try:
        provision(args)
    except FileExistsError:
        parser.exit(1, message("This candidate is already provisioned. Create a new candidate to change its values.",
                               "此候选连接已配置。请创建新的候选连接以更改配置。") + "\n")
    except (getpass.GetPassWarning, EOFError, KeyboardInterrupt):
        parser.exit(1, message("Private input requires your local interactive terminal.", "请在本地交互式终端中输入私有信息。") + "\n")
    except OSError:
        parser.exit(1, message("Cannot save the private configuration. Check local file permissions.",
                               "无法保存私有配置。请检查本地文件权限。") + "\n")
    except ValueError as error:
        parser.exit(1, str(error) + "\n")
    print(message("Private configuration is ready. Continue setup in the same session.", "私有配置已就绪。请回到同一会话继续设置。"))


if __name__ == "__main__":
    main()
