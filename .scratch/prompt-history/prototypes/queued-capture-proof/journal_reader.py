"""Read complete JSONL records without retaining message or attachment bodies."""
import hashlib
import json
import os
import pathlib
import re


FIELDS = (
    'type', 'operation', 'uuid', 'parentUuid', 'promptId', 'promptSource',
    'origin', 'userType', 'sessionId', 'isMeta', 'isSidechain',
)


def read_journal(path, previous=None):
    path = pathlib.Path(path)
    try:
        with path.open('rb') as stream:
            before = os.fstat(stream.fileno())
            raw = stream.read()
            after = os.fstat(stream.fileno())
    except OSError:
        return {'file': path.name, 'complete': False, 'gaps': ['journal-unavailable'], 'rows': []}
    rows, gaps, offset = [], [], 0
    read_stable = (
        (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
        == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
        and len(raw) == after.st_size
    )
    if not read_stable:
        gaps.append('read-mutated')
    if previous:
        if not previous.get('complete'):
            gaps.append('previous-gap')
        if (previous.get('device'), previous.get('inode')) != (after.st_dev, after.st_ino):
            gaps.append('journal-replaced')
        length = previous.get('completeBytes')
        if length is None or previous.get('prefixDigest') is None:
            gaps.append('previous-gap')
        elif len(raw) < length:
            gaps.append('journal-truncated')
        elif hashlib.sha256(raw[:length]).hexdigest() != previous['prefixDigest']:
            gaps.append('prefix-changed')
    for part in raw.splitlines(keepends=True):
        if not part.endswith(b'\n'):
            break
        try:
            value = json.loads(part)
        except ValueError:
            gaps.append('malformed-json')
            offset += len(part)
            continue
        if not isinstance(value, dict) or not isinstance(value.get('type'), str):
            gaps.append('malformed-record')
            offset += len(part)
            continue
        row = {key: value[key] for key in FIELDS if key in value}
        row.update(offset=offset, keys=sorted(value))
        body = None
        if value.get('type') == 'queue-operation':
            body = value.get('content')
        elif value.get('type') == 'user' and isinstance(value.get('message'), dict):
            body = value['message'].get('content')
        if isinstance(body, list):
            body = '\n'.join(block.get('text', '') for block in body
                             if isinstance(block, dict) and block.get('type') == 'text')
        if isinstance(body, str):
            row['textDigest'] = hashlib.sha256(body.encode()).hexdigest()
            row['labels'] = sorted({label[5:] for label in re.findall(r'PT35-[A-Z0-9-]+', body)})
        rows.append(row)
        offset += len(part)
    return {
        'file': path.name, 'device': after.st_dev, 'inode': after.st_ino,
        'bytes': len(raw), 'completeBytes': offset,
        'prefixDigest': hashlib.sha256(raw[:offset]).hexdigest(),
        'hasPartialTail': offset != len(raw), 'readStable': read_stable,
        'complete': not gaps, 'gaps': gaps, 'rows': rows,
    }


def collect_observation(record, config):
    record = dict(record)
    for key in ('inputText', 'resultText'):
        body = record.pop(key, None)
        if isinstance(body, str):
            record[key + 'Digest'] = hashlib.sha256(body.encode()).hexdigest()
    record['journals'] = [
        read_journal(path) for path in sorted((pathlib.Path(config) / 'projects').rglob('*.jsonl'))
        if path.stem == record['sessionId']
    ]
    return record
