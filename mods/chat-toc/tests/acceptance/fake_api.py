"""A scripted stand-in for the Messages API, so a real host can run a turn
with tool steps and no model behind it (CT-TURN-004's 「进行中 · N 步」).

The host is pointed at it with ANTHROPIC_BASE_URL and a made-up
ANTHROPIC_API_KEY (World.fake_api). A request whose last user text holds
`trigger` gets a scripted turn: one Read tool call per step, each answer held
back `delay` seconds so the Pane can be read between steps, then a closing
text. Any other request (titles, summaries, a second prompt) gets a short
text. Nothing leaves the machine.
"""
import http.server
import json
import threading
import time


def _sse(events: list[dict]) -> bytes:
    return b"".join(f"event: {e['type']}\ndata: {json.dumps(e, ensure_ascii=False)}\n\n".encode() for e in events)


def _message(blocks: list[dict], stop: str, n: int) -> list[dict]:
    events = [{"type": "message_start", "message": {
        "id": f"msg_fake_{n:04d}", "type": "message", "role": "assistant", "model": "fake-model", "content": [],
        "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 1}}}]
    for i, block in enumerate(blocks):
        if block["type"] == "text":
            events += [{"type": "content_block_start", "index": i, "content_block": {"type": "text", "text": ""}},
                       {"type": "content_block_delta", "index": i, "delta": {"type": "text_delta", "text": block["text"]}}]
        else:
            events += [{"type": "content_block_start", "index": i, "content_block": {
                           "type": "tool_use", "id": block["id"], "name": block["name"], "input": {}}},
                       {"type": "content_block_delta", "index": i, "delta": {
                           "type": "input_json_delta", "partial_json": json.dumps(block["input"])}}]
        events.append({"type": "content_block_stop", "index": i})
    events += [{"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None},
                "usage": {"output_tokens": 5}},
               {"type": "message_stop"}]
    return events


def _last_user_text(body: dict) -> str:
    for message in reversed(body.get("messages") or []):
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content
        texts = [b.get("text", "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text"]
        if texts:
            return "\n".join(texts)
    return ""


def _results_since_trigger(body: dict, trigger: str) -> int:
    """Tool results the conversation holds after the triggering prompt."""
    count, seen = 0, False
    for message in body.get("messages") or []:
        content = message.get("content")
        blocks = [{"type": "text", "text": content}] if isinstance(content, str) else content or []
        for block in blocks:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text" and trigger in block.get("text", ""):
                seen, count = True, 0
            elif seen and block.get("type") == "tool_result":
                count += 1
    return count


class FakeApi:
    def __init__(self, trigger: str, read_path: str, steps: int = 2, delay: float = 3.0, reply: str = "完成") -> None:
        self.trigger, self.read_path, self.steps, self.delay, self.reply = trigger, read_path, steps, delay, reply
        self.requests: list[dict] = []
        self.count = 0
        api = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args) -> None:
                pass

            def _send(self, code: int, kind: str, payload: bytes) -> None:
                self.send_response(code)
                self.send_header("content-type", kind)
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_GET(self) -> None:
                api.requests.append({"method": "GET", "path": self.path})
                self._send(404, "application/json", b'{"type":"error","error":{"type":"not_found_error","message":"fake"}}')

            def do_HEAD(self) -> None:
                self._send(200, "text/plain", b"")

            def do_POST(self) -> None:
                length = int(self.headers.get("content-length") or 0)
                raw = self.rfile.read(length) if length else b"{}"
                try:
                    body = json.loads(raw)
                except json.JSONDecodeError:
                    body = {}
                api.answer(self, body)

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self) -> "FakeApi":
        self.thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self.server.shutdown()
        self.server.server_close()

    def answer(self, handler, body: dict) -> None:
        self.count += 1
        n = self.count
        path = handler.path
        record = {"method": "POST", "path": path, "stream": bool(body.get("stream")), "tools": len(body.get("tools") or [])}
        self.requests.append(record)
        if "count_tokens" in path:
            handler._send(200, "application/json", b'{"input_tokens": 10}')
            return
        if "/messages" not in path:
            handler._send(404, "application/json", b'{"type":"error","error":{"type":"not_found_error","message":"fake"}}')
            return
        blocks, stop = [{"type": "text", "text": "ok"}], "end_turn"
        if body.get("tools") and self.trigger in json.dumps(body.get("messages") or [], ensure_ascii=False):
            done = _results_since_trigger(body, self.trigger)
            record["scripted"] = done
            time.sleep(self.delay if done else 1.0)
            if done < self.steps:
                blocks = [{"type": "tool_use", "id": f"toolu_fake_{n:04d}", "name": "Read",
                           "input": {"file_path": self.read_path}}]
                stop = "tool_use"
            else:
                blocks = [{"type": "text", "text": self.reply}]
        if body.get("stream"):
            handler._send(200, "text/event-stream", _sse(_message(blocks, stop, n)))
        else:
            message = {"id": f"msg_fake_{n:04d}", "type": "message", "role": "assistant", "model": "fake-model",
                       "content": blocks, "stop_reason": stop, "stop_sequence": None,
                       "usage": {"input_tokens": 10, "output_tokens": 5}}
            handler._send(200, "application/json", json.dumps(message, ensure_ascii=False).encode())
