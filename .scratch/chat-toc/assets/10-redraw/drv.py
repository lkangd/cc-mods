"""Tiny persistent PTY driver: `serve <cwd> <cols> <rows> -- argv...` and `c '<json>'`."""
import json, os, pty, socket, struct, sys, threading, time, fcntl, termios, signal
import pyte

os.chdir(os.path.dirname(os.path.abspath(__file__))); SOCK = 'drv.sock'
KEYS = {"enter": "\r", "esc": "\x1b", "up": "\x1b[A", "down": "\x1b[B", "right": "\x1b[C", "left": "\x1b[D",
        "tab": "\t", "backspace": "\x7f", "ctrl-c": "\x03", "ctrl-x": "\x18", "ctrl-o": "\x0f",
        "pgup": "\x1b[5~", "pgdn": "\x1b[6~", "home": "\x1b[H", "end": "\x1b[F", "ctrl-home": "\x1b[1;5H", "ctrl-end": "\x1b[1;5F"}

class Scr(pyte.Screen):
    def __init__(s, c, r, reply): super().__init__(c, r); s._reply = reply
    def write_process_input(s, d): s._reply(d)

def serve(cwd, cols, rows, argv):
    env = {k: v for k, v in os.environ.items() if not k.startswith(('CLAUDE', 'CMUX', 'TERM_PROGRAM'))}
    env.update(TERM='xterm-256color', LANG='en_US.UTF-8', COLORTERM='truecolor')
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd); os.execvpe(argv[0], argv, env)
    lock = threading.Lock()
    def w(d):
        try: os.write(fd, d.encode())
        except OSError: pass
    scr = Scr(cols, rows, w); st = pyte.ByteStream(scr)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    def rd():
        while True:
            try: d = os.read(fd, 65536)
            except OSError: break
            if not d: break
            with lock: st.feed(d)
    threading.Thread(target=rd, daemon=True).start()
    if os.path.exists(SOCK): os.unlink(SOCK)
    srv = socket.socket(socket.AF_UNIX); srv.bind(SOCK); srv.listen(1)
    while True:
        conn, _ = srv.accept()
        try:
            q = json.loads(conn.recv(1 << 20).decode()); op = q['op']; out = 'ok'
        except Exception as ex:
            conn.sendall(json.dumps('bad ' + str(ex)).encode()); conn.close(); continue
        if op == 'type': w(q['text'])
        elif op == 'key':
            for n in q['names']: w(KEYS[n]); time.sleep(0.15)
        elif op == 'click':
            c, r = q['col'] + 1, q['row'] + 1
            w(f"\x1b[<35;{c};{r}M"); time.sleep(0.3); w(f"\x1b[<0;{c};{r}M"); time.sleep(0.05); w(f"\x1b[<0;{c};{r}m")
        elif op == 'wheel':
            for _ in range(q.get('ticks', 1)):
                w(f"\x1b[<{64 if q['up'] else 65};{q['col']+1};{q['row']+1}M"); time.sleep(q.get('gap', 0.05))
        elif op == 'pid': out = pid
        elif op == 'screen':
            with lock: out = '\n'.join(f"{y:02d}|" + ''.join(scr.buffer[y][x].data for x in range(scr.columns)).rstrip() for y in range(scr.lines))
        elif op == 'find':
            with lock:
                out = []
                for y in range(scr.lines):
                    line = scr.buffer[y]; text, xs = '', []
                    for x in range(scr.columns):
                        text += line[x].data; xs += [x] * len(line[x].data)
                    i = text.find(q['needle'])
                    if i >= 0: out.append([y, xs[i]])
        elif op == 'quit':
            os.kill(pid, signal.SIGTERM); conn.sendall(b'"bye"'); conn.close(); break
        conn.sendall(json.dumps(out).encode()); conn.close()

def client(q):
    s = socket.socket(socket.AF_UNIX); s.connect(SOCK); s.sendall(q.encode())
    d = b''
    while True:
        b = s.recv(1 << 20)
        if not b: break
        d += b
    r = json.loads(d)
    print(r if isinstance(r, str) else json.dumps(r))

if __name__ == '__main__':
    if sys.argv[1] == 'serve':
        i = sys.argv.index('--'); serve(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[i + 1:])
    else: client(sys.argv[2])
