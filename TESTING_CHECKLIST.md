# TectoLite Time Enhancement - Testing Checklist

## Pre-Testing Setup
- [ ] Electron dev mode running (`npm run electron-dev`)
- [ ] Browser console open (F12)
- [ ] No TypeScript errors shown
- [ ] Application fully loaded

---

## Feature 1: Time Mode Toggle

### Test Case 1.1 - Toggle Visibility
- [ ] "Ago" checkbox visible in timeline bar
- [ ] Checkbox is unchecked by default
- [ ] Checkbox label is clear and readable

### Test Case 1.2 - Mode Switching
- [ ] Click checkbox to enable "Ago" mode
- [ ] Current time display updates (shows negative value)
- [ ] Time label changes from "Ma" to "years ago"
- [ ] Click checkbox again to disable (back to positive)

### Test Case 1.3 - Mode Persistence
- [ ] Switch to negative mode
- [ ] Reload page
- [ ] Mode should remain negative (if state persists)

---

## Feature 2: Clickable Current Time

### Test Case 2.1 - Click Interaction
- [ ] Click on time value in timeline bar
- [ ] Modal dialog opens
- [ ] Modal is centered on screen
- [ ] Modal has semi-transparent overlay

### Test Case 2.2 - Modal Content
- [ ] Modal shows "Set Current Time" title
- [ ] Input field pre-populated with current time
- [ ] Input field is focused and selected
- [ ] Cancel and Confirm buttons visible

### Test Case 2.3 - Input Validation
- [ ] Type valid number (e.g., "100")
- [ ] Press Enter to confirm
- [ ] Modal closes and time updates
- [ ] Type invalid input (e.g., "abc")
- [ ] Press Enter
- [ ] Alert shown "Please enter a valid time value"

### Test Case 2.4 - Keyboard Navigation
- [ ] Click time to open modal
- [ ] Type new value
- [ ] Press Enter → Modal closes, time updates
- [ ] Click time again
- [ ] Type new value
- [ ] Press Escape → Modal closes, time unchanged
- [ ] Click time again
- [ ] Press Escape → Modal closes cleanly

### Test Case 2.5 - Mode-Aware Input
- [ ] Enable "Ago" (negative mode)
- [ ] Click current time (shows negative value)
- [ ] Modal opens with negative value pre-filled
- [ ] Type "-100"
- [ ] Press Enter
- [ ] Time updates correctly
- [ ] Display shows correct transformation

---

## Feature 3: Max Time Control

### Test Case 3.1 - Control Location
- [ ] "Max:" label visible in timeline bar
- [ ] Input field next to it with default value (500)
- [ ] Input is of type "number"

### Test Case 3.2 - Changing Max Time
- [ ] Change value from 500 to 1000
- [ ] Press Enter or click elsewhere
- [ ] Time slider range updates (max=1000)
- [ ] Current time clamped if it exceeds new max
- [ ] If current time was 600 with old max 500:
  - [ ] Time should clamp to new max or update appropriately

### Test Case 3.3 - Interaction with Slider
- [ ] Set max time to 200
- [ ] Drag slider to the end
- [ ] Slider stops at new max
- [ ] Time display shows max value

---

## Feature 4: Time Transformation in Property Fields

### Test Case 4.1 - Plate Birth Time
- [ ] Create or select a plate
- [ ] Open properties panel
- [ ] See "Birth Time" field
- [ ] In positive mode: Enter "100" → stored as 100
- [ ] In negative mode: Enter "-100" → stored as 400 (if max=500)
- [ ] Display updates correctly

### Test Case 4.2 - Plate Death Time
- [ ] Select a plate with properties visible
- [ ] See "Death Time" field
- [ ] In positive mode: Enter "300" → stored as 300
- [ ] In negative mode: Enter "-200" → stored as 300 (if max=500)
- [ ] Leave field empty → Death time set to null/never

### Test Case 4.3 - Feature Creation Time
- [ ] Create a feature (mountain, volcano, etc.)
- [ ] Properties panel shows "Created At(Ma)"
- [ ] In positive mode: Enter "50" → stored as 50
- [ ] In negative mode: Enter "-50" → stored as 450 (if max=500)

### Test Case 4.4 - Feature Death Time
- [ ] In properties panel, see "Ends At(Ma)"
- [ ] In positive mode: Enter "200" → stored as 200
- [ ] In negative mode: Enter "-100" → stored as 400 (if max=500)
- [ ] Leave empty for "Active/Never ends"

---

## Feature 5: Heightmap Export Projections

### Test Case 5.1 - Export Dialog
- [ ] Click "H-Map" button in header
- [ ] Export dialog opens
- [ ] Dialog shows projection dropdown
- [ ] Dropdown lists all options:
  - [ ] Equirectangular
  - [ ] Mercator
  - [ ] Mollweide
  - [ ] Robinson
  - [ ] Orthographic (Globe)
  - [ ] QGIS note

### Test Case 5.2 - Projection Selection
- [ ] Select "Equirectangular"
- [ ] Check resolution fields
- [ ] Click "Export"
- [ ] Image should generate in equirectangular projection
- [ ] Verify map appears correctly (flat world map)

### Test Case 5.3 - Other Projections
- [ ] Try "Mercator" projection
- [ ] Verify export produces correct projection
- [ ] Try "Robinson" projection
- [ ] Verify export produces correct projection
- [ ] Try "Orthographic" (globe)
- [ ] Verify export produces globe/3D view

### Test Case 5.4 - Resolution Control
- [ ] Set width to 2048, height to 1024
- [ ] Click Export
- [ ] Image should be correct size
- [ ] Set width to 8192, height to 4096
- [ ] Export should complete (may be slower)

---

## Integration Tests

### Test Case 6.1 - Mode Switching Doesn't Break Features
- [ ] Create plate in positive mode
- [ ] Switch to negative mode
- [ ] Plate should still be visible and functional
- [ ] Set time using modal in negative mode
- [ ] Plate should render at correct time
- [ ] Switch back to positive mode
- [ ] Everything should work normally

### Test Case 6.2 - Multiple Time Operations
- [ ] Open time modal
- [ ] Set to 100
- [ ] Change mode
- [ ] Open time modal again
- [ ] Verify display shows transformed value
- [ ] Set new value
- [ ] Verify storage is correct internal time

### Test Case 6.3 - Export with Time Mode Active
- [ ] Activate negative time mode
- [ ] Set current time to some negative value
- [ ] Click H-Map export
- [ ] Export should complete successfully
- [ ] Image should represent correct time

### Test Case 6.4 - Undo/Redo with Transformations
- [ ] Create plate with birth time
- [ ] Switch to negative mode
- [ ] Edit plate birth time in modal
- [ ] Click Undo
- [ ] Birth time should revert
- [ ] Click Redo
- [ ] Birth time should update again

---

## Edge Cases

### Test Case 7.1 - Boundary Values
- [ ] Set max time to 1
- [ ] Try to set current time to 0
- [ ] Try to set to 1 (should work)
- [ ] Try to set to 2 (should clamp to 1)

### Test Case 7.2 - Negative Mode Edge Cases
- [ ] Set max time to 100, mode to negative
- [ ] Try to set time to -100 (minimum)
- [ ] Try to set time to 0 (maximum in negative mode)
- [ ] Try to set time to +100 (should transform to 0)

### Test Case 7.3 - Rapid Mode Switching
- [ ] Toggle mode on/off rapidly
- [ ] UI should remain responsive
- [ ] Current time should transform correctly each time
- [ ] No console errors

### Test Case 7.4 - Large Max Time Values
- [ ] Set max time to 1000000
- [ ] Set current time in negative mode
- [ ] Values should handle large numbers correctly
- [ ] No precision loss or NaN errors

---

## Performance Tests

### Test Case 8.1 - Responsiveness
- [ ] Toggle mode multiple times rapidly
- [ ] UI should respond immediately
- [ ] No lag or stuttering

### Test Case 8.2 - Modal Performance
- [ ] Open/close modal 10 times
- [ ] Each action should be instant
- [ ] No memory leaks (check DevTools)

### Test Case 8.3 - Large Scenes
- [ ] Create many plates and features
- [ ] Toggle time mode
- [ ] Time transformations should still be instant
- [ ] Rendering should not be affected

---

## Visual/UI Tests

### Test Case 9.1 - Styling
- [ ] Current time display is blue and clickable-looking
- [ ] Hover over time display → cursor changes to pointer
- [ ] Hover over time display → background color changes
- [ ] Modal has professional appearance
- [ ] Modal buttons are properly styled

### Test Case 9.2 - Responsive Layout
- [ ] Timeline bar fits properly on various screen sizes
- [ ] All controls aligned horizontally
- [ ] Max time control right of current time
- [ ] Responsive to window resize

### Test Case 9.3 - Theme Compatibility
- [ ] Toggle between dark/light themes
- [ ] Modal appears in correct theme colors
- [ ] All time controls visible in both themes
- [ ] Text colors have sufficient contrast

---

## Regression Tests

### Test Case 10.1 - Existing Features
- [ ] Time slider still works normally
- [ ] Play/pause still functions
- [ ] Speed selection still works
- [ ] Reset time button works
- [ ] All projection selections work

### Test Case 10.2 - Existing UI Elements
- [ ] All sidebar controls intact
- [ ] All header buttons functional
- [ ] Properties panel displays correctly
- [ ] Timeline panel shows events
- [ ] No visual glitches or overlap

### Test Case 10.3 - Data Integrity
- [ ] Create plate and save
- [ ] Load saved data
- [ ] Times should be correct
- [ ] No data corruption
- [ ] All features preserve their properties

---

## Final Verification

### Pre-Release Checklist
- [ ] All test cases pass
- [ ] No console errors or warnings
- [ ] No TypeScript compilation errors
- [ ] Build completes successfully
- [ ] Electron app launches without errors
- [ ] No memory leaks detected
- [ ] Performance is acceptable

### Documentation
- [ ] IMPLEMENTATION_SUMMARY.md exists and is accurate
- [ ] FEATURE_QUICK_REFERENCE.md exists and is clear
- [ ] FEATURE_IMPLEMENTATION_COMPLETE.md exists
- [ ] Code comments explain transformation logic
- [ ] No outdated documentation

### Sign-Off
- [ ] Feature works as specified
- [ ] All requirements met
- [ ] Ready for production deployment

---

**Test Date:** _______________  
**Tested By:** _______________  
**Result:** PASS / FAIL  
**Notes:** ___________________________________________________________
