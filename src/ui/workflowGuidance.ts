/** Shared user-facing explanations for workflows whose timeline effects are easy to miss. */
export const LINK_TOOL_HELP =
    'Choose the leader on the map or in Explorer, then the follower. The follower inherits leader motion from the current timeline time (Hotkey: L).';

export const FUSE_TOOL_HELP =
    'Merge two plates at the current timeline time. The first-selected plate supplies the new plate\'s initial motion (Hotkey: G).';

export const FEATURE_TOOL_HELP =
    'Place visible map features on the selected plate. Hotspots are manually placed fixed markers (Hotkey: F).';

export const LINE_COLOR_HELP =
    'Picking a color creates a per-line override. Changing that line type\'s default color will no longer replace it.';

export const LAYER_ORDER_HELP =
    'User stacking order. At equal values, lines render above landmasses by default; larger values can override that order.';

export const LINK_WINDOW_HELP =
    'Motion inheritance is active only inside this start/end window. Leave the end blank to keep the link active.';

export const EXPORT_CROP_HELP =
    'A different output aspect ratio crops the current view symmetrically; it never reveals extra map area.';

export const FUSION_PROXY_HELP =
    'Overlays linked to either parent continue following the fused plate, including later motion changes.';

export const JSON_ENTIRE_TIMELINE_HELP =
    'Preserves plate births, motion changes, geometry edits, links, and earlier timeline history.';

export const JSON_FROM_CURRENT_HELP =
    'Starts a new timeline at 0 from what is visible now, keeps future events, and discards earlier history.';
