"""FairTurn: one generation at a time, in arrival order; a gone client gives up its turn.

Run: .venv-voxcpm/bin/python services/voxcpm/test_fair_turn.py  (no model, no network)
"""
import sys, threading, time
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from server import FairTurn, Cancelled
lock = FairTurn(); order = []; gone = {"c": False}
def worker(name, delay, cancel=None):
    time.sleep(delay)
    try:
        with lock.turn(cancel):
            order.append(name); time.sleep(0.3)
    except Cancelled:
        order.append(name + ":cancelled")
ts = [threading.Thread(target=worker, args=(f"s{i}", i * 0.02, (lambda: gone["c"]) if i == 2 else None)) for i in range(1, 6)]
[t.start() for t in ts]; time.sleep(0.15); gone["c"] = True
[t.join() for t in ts]; print(order)
assert order == ["s1", "s2:cancelled", "s3", "s4", "s5"], order
print("fifo+cancel ok")
