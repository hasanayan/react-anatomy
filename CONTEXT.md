# react-anatomy

A deterministic overlay that labels the anatomy of a rendered component: every
`data-slot` part gets a callout in a gutter outside the frame, reached by a
leader that never crosses another.

## Language

**Slot**:
A part of a component marked with a `data-slot` attribute in the DOM. The unit
of anatomy the overlay documents.
_Avoid_: part, element

**Region**:
A discovered slot with its geometry and place in the tree, still holding its
DOM element. What collection produces and the overlay navigates.
_Avoid_: node, box

**Zone**:
A region reduced to pure data — id, rect, depth, radii — with no DOM handle.
The form in which geometry crosses to the solve.
_Avoid_: rect, shape

**View**:
The slice of the region tree currently being labelled, with depths rebased so
its shallowest members sit at depth 1.
_Avoid_: level set, selection

**Solve**:
The exact search that assigns every zone in a view a side, a label position,
and a leader route. Deterministic: same zones in, same numbers out.
_Avoid_: layout pass, calculation

**Solver**:
The module a host asks for placements. Owns the solve's transport (worker or
synchronous) and the latest-wins rule: a newer request supersedes an in-flight
one, which resolves to nothing.
_Avoid_: worker client, transport, engine

**Placement**:
A solve's answer with regions re-attached: the labels, leaders, and frames the
overlay draws.
_Avoid_: result, output

**Label**:
The named chip placed in a gutter for one zone.
_Avoid_: chip, callout, annotation

**Leader**:
The dashed line from a zone's edge to its label: a stub perpendicular to the
rail, then a fan to the label's edge.
_Avoid_: line, connector

**Gutter**:
The padding reserved on each side of the frame for labels, sized before the
solve so the component never moves.
_Avoid_: margin, rail area

**Fitted gutters**:
The opt-in static-overlay mode where the reveal waits for the solve and the
gutters are cut to what the labels actually occupy, rather than to the
conservative bound reserved up front.
_Avoid_: tight mode, auto-crop

**Frame**:
The dashed rectangle drawn around a zone — the inset rect the solve returns,
so the border on screen is the border the label points at.
_Avoid_: outline, border

**Dive**:
The navigation step into a zone: the view becomes that zone as container plus
the zones directly inside it.
_Avoid_: drill-down, zoom

**Overlay session**:
The measure→solve→resolve choreography the overlay runs behind one hook:
observing regions, measuring labels, posting the solve, and reading the
placement into draw state. The overlay asks for a session and paints what it
returns, never touching the solve's argument shape.
_Avoid_: controller, engine, pipeline
