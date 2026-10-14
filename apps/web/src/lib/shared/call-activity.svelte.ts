// Whether this tab is in a voice call, for surfaces outside the room feature
// that must not interrupt one (the update notice holds a reload until the call
// ends). The room feature's voice session keeps it current.

export const callActivity = $state({ active: false });
