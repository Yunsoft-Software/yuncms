# Studio UI conventions

YunCMS Studio keeps shared interaction patterns in `apps/studio/src/components`. Reusable interface behavior should be implemented there instead of being recreated inside individual screens.

## Shared components

`apps/studio/src/components/index.js` is the shared component entry point. Components that are intended for reuse across Studio screens should be exported from this file.

Examples include:

- navigation and command palette surfaces;
- dialogs and modals;
- pagination;
- file previews and file pickers;
- collection and field type icons;
- schema visualization;
- branding and language controls.

A screen may still own layout and product-specific behavior, but reusable interaction primitives should remain shared.

## Dialogs and confirmations

Studio does not use browser-native `alert`, `prompt` or `confirm` dialogs.

Use the shared dialog and modal components instead:

- `DialogProvider` and `useConfirmDialog` for confirmation flows;
- `Modal` for reusable modal surfaces;
- specialized shared modal components for file selection, previews and similar workflows.

This keeps keyboard behavior, focus management, styling, localization and accessibility consistent across the Studio.

## Destructive actions

Destructive actions must:

- use an explicit confirmation when accidental activation could lose data;
- keep the destructive action visually secondary until the user reaches the relevant context;
- use clear labels that describe what will be removed;
- never rely on a browser-native confirmation dialog.

## Keyboard and focus behavior

Shared overlays should provide predictable keyboard behavior:

- Escape closes the topmost dismissible surface;
- Tab remains within modal surfaces while they are open;
- focus returns to a sensible place after closing;
- icon-only controls have an accessible label;
- shortcuts must not override normal typing inside inputs, textareas, selects or editable content.

## Visual consistency

Shared components should use the semantic Studio tokens rather than introducing feature-specific hard-coded theme colors. Light, dark and customized accent modes should remain functional without separate component implementations.

Motion should explain state changes and respect `prefers-reduced-motion`.

## Adding a new reusable component

When adding a component that is useful in more than one screen:

1. place it in `apps/studio/src/components`;
2. export it from `apps/studio/src/components/index.js`;
3. keep its labels localizable when it contains user-facing copy;
4. include keyboard and focus behavior where relevant;
5. add focused regression coverage for important interaction contracts.

The Studio test suite includes source-level checks that prevent browser-native dialogs and help keep shared components centralized.
