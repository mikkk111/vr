# Human Soft Body V1.1 — stability revision

Reuses the exact V1.0 prepared GLB and original Zelda V13 whole-object engine. No duplicate model and no changes to previous versions.

V1.0 failure reported by owner: violent jerking/bouncing during a fall. Source audit found post-solve quaternion teleportation, nearby overlapping rigid collision proxies and unconstrained tissue contact feedback into the rigid body.

V1.1:
- Rigid collision group filters exclude nearby skeletal connections and overlapping rest-pose proxies. Remote limb collision and invisible room floor remain.
- Native elbow/knee hinges, fixed clavicle/toe connections for stability, bounded ball-joint angular velocity stops before Rapier step. Ball limits are compliant rather than hard mathematical bounds.
- Restitution zero, more angular damping, sleeping enabled, floor pose updated only when changed, velocity and controller impulse bounds.
- Tissue follows skeletal target displacement, simulates damped relative deformation, retains elastic edge/volume constraints and sampled surface collision. No tissue-to-rigid reaction impulses in this revision: one-way coupling intentionally avoids energy injection; not a fully coupled biomechanical solver. Gravity, pressure mode, skin friction, original texture and original geometry remain.
- The actual character cage (1,973 nodes, 7,236 tetrahedra, 2,831 skin samples) was exercised for 72 steps with a prescribed 90-degree rotation/descent. Minimum volume ratio 0.9990242, no inverted tetrahedra, maximum local node residual 11.86 mm; peak sampled contact violation 44.30 mm in transient floor contact, final 0. This is a tissue-only test, not a complete ragdoll drop.
- Node syntax checks passed. Full articulated regression script and Actions workflow added; results must be checked before claiming full drop stability. Hardware and Pages deployment not independently verified.

No full-surface continuous collision guarantees. Intended first diagnostic is an undisturbed drop, followed by limb dragging and pressure tests.
