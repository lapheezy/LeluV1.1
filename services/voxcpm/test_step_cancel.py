"""A gone client stops a VoxCPM2 generation between two steps (live conversation)."""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# A stand-in for voxcpm.model.voxcpm2: a module-level tqdm driving a step loop.
pkg = types.ModuleType("voxcpm")
model_pkg = types.ModuleType("voxcpm.model")
v2 = types.ModuleType("voxcpm.model.voxcpm2")
v2.tqdm = lambda iterable, *a, **k: iter(iterable)
sys.modules.update({"voxcpm": pkg, "voxcpm.model": model_pkg, "voxcpm.model.voxcpm2": v2})

import server  # noqa: E402

assert server._install_step_cancellation() is True
assert server._install_step_cancellation() is True, "installing twice is harmless"

# No check set: the loop runs to the end, as before.
assert list(v2.tqdm(range(5))) == [0, 1, 2, 3, 4]

# The client leaves after step 3: the generation stops there.
steps = []
gone = {"now": False}
server._step_check.fn = lambda: gone["now"]
try:
    for i in v2.tqdm(range(100)):
        steps.append(i)
        if i == 3:
            gone["now"] = True
    raise AssertionError("generation should have been cancelled")
except server.CancelledMidGeneration as exc:
    assert exc.steps == 4, exc.steps
    assert isinstance(exc, server.Cancelled), "handled like any cancellation"
finally:
    server._step_check.fn = None
assert steps == [0, 1, 2, 3], steps
print("step cancellation ok")
