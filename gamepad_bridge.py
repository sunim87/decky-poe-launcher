"""Read Linux joystick input without grabbing the controller from Steam."""
import array
import fcntl
import json
from pathlib import Path
import select
import signal
import struct
import sys
import time

EVENT = struct.Struct("IhBB")
BUTTONS = {304: 0, 305: 1, 310: 4, 311: 5, 544: 12, 545: 13, 546: 14, 547: 15}


def run(output):
    temporary = output.with_suffix(".tmp")
    paused = output.with_suffix(".json.paused")
    while True:
        if paused.exists():
            output.unlink(missing_ok=True)
            while paused.exists():
                time.sleep(0.5)
            continue
        for device in sorted(Path("/dev/input").glob("js*")):
            try:
                with device.open("rb", buffering=0) as joystick:
                    axes = array.array("B", [0] * 64)
                    buttons = array.array("H", [0] * 512)
                    fcntl.ioctl(joystick, 0x80406A32, axes)
                    fcntl.ioctl(joystick, 0x84006A34, buttons)
                    if 304 not in buttons or 305 not in buttons:
                        continue
                    state = [False] * 16
                    sticks = [0.0, 0.0]
                    next_pause_check = 0.0
                    while True:
                        now = time.monotonic()
                        if now >= next_pause_check:
                            if paused.exists():
                                break
                            next_pause_check = now + 0.25
                        readable, _, _ = select.select([joystick], [], [], 0.25)
                        if readable:
                            data = joystick.read(EVENT.size)
                            if len(data) != EVENT.size:
                                break
                            _, value, kind, index = EVENT.unpack(data)
                            kind &= 0x7F
                            if kind == 1 and buttons[index] in BUTTONS:
                                state[BUTTONS[buttons[index]]] = bool(value)
                            elif kind == 2 and index < len(axes):
                                axis = axes[index]
                                if axis in (0, 1):
                                    sticks[axis] = value / 32768
                                elif axis in (16, 17):
                                    negative, positive = (14, 15) if axis == 16 else (12, 13)
                                    state[negative], state[positive] = value < 0, value > 0
                        temporary.write_text(json.dumps({"buttons": state, "axes": sticks}))
                        temporary.replace(output)
            except OSError:
                pass
            output.unlink(missing_ok=True)
        time.sleep(1)


if __name__ == "__main__":
    output = Path(sys.argv[1])

    def stop(_signal, _frame):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop)
    try:
        run(output)
    finally:
        output.with_suffix(".json.paused").unlink(missing_ok=True)
