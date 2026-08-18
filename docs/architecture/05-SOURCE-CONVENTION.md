# 05 — Source Convention

## 1. Purpose

This convention governs **authored reconstruction source** so that humans and coding Agents can infer component boundaries, states and intent from source code consistently.

It does not claim to be a browser standard. HTML correctness remains governed by the web platform; these rules are WebR project conventions built on established public practices.

## 2. HTML

Use semantic HTML whenever the element's meaning is known.

Prefer native elements before generic containers, for example:

- `header`, `nav`, `main`, `section`, `article`, `footer`
- `button` for actions
- `a` for navigation
- native form controls where appropriate

Use ARIA to supplement semantics, not replace correct native semantics unnecessarily.

Authored HTML must remain compatible with WHATWG HTML semantics.

## 3. CSS class naming

WebR uses a SUIT CSS-inspired authored-class convention with a `wr-` namespace.

### Component

```text
wr-ComponentName
```

Example:

```html
<header class="wr-Header"></header>
```

### Descendant

```text
wr-ComponentName-descendentName
```

Example:

```html
<nav class="wr-Header-navigation"></nav>
```

### Modifier

```text
wr-ComponentName--modifierName
```

Example:

```html
<button class="wr-Button wr-Button--primary"></button>
```

### State

```text
is-stateName
```

Examples:

```text
is-active
is-open
is-disabled
is-loading
is-selected
```

State classes represent transient/behavioral state and should not become generic styling shortcuts.

### Utility

```text
u-utilityName
```

Examples:

```text
u-hidden
u-visuallyHidden
```

Utilities should be small, explicit and reusable.

## 4. Example

```html
<header class="wr-Header is-compact">
  <a class="wr-Header-logo" href="/">...</a>

  <nav class="wr-Header-navigation" aria-label="Primary">...</nav>

  <button class="wr-IconButton wr-IconButton--ghost" type="button" aria-expanded="false">
    <svg class="wr-Icon wr-Icon--viewLeft" aria-hidden="true">...</svg>
  </button>
</header>
```

The names make the following machine-readable at a glance:

- project namespace
- component
- descendant relationship
- modifier/variant
- transient state
- utility role

## 5. Design tokens

Authored CSS custom properties use the `--wr-` namespace and semantic hierarchy.

Recommended shape:

```text
--wr-<category>-<role>-<variant>
```

Examples:

```css
--wr-color-text-primary
--wr-color-text-secondary
--wr-color-background-primary
--wr-color-border-subtle
--wr-space-100
--wr-space-200
--wr-radius-small
--wr-radius-medium
--wr-font-size-body
--wr-font-weight-medium
--wr-shadow-elevated
--wr-duration-fast
```

Prefer semantic tokens over duplicating raw values throughout components.

## 6. Source identifiers

When the implementation language supports these conventions:

- Components/types/classes: `PascalCase`
- functions/variables: `camelCase`
- constants with true global constant semantics: `UPPER_SNAKE_CASE`
- files containing one primary component: match the component name

Do not encode evidence-state IDs into user-facing source identifiers unless there is a specific tracing requirement.

## 7. Component files

Framework choice is deferred, so the physical layout is illustrative rather than framework-binding.

A component-oriented implementation should keep related source near the component, e.g.:

```text
components/
└── Header/
    ├── Header.<source>
    ├── Header.<style>
    ├── Header.<test>
    └── index.<source>
```

The implementation must not choose a framework merely to match this example.

## 8. Formatting

Use automatic formatting. **Prettier is the default where it supports the chosen source format/runtime.**

Formatting concerns include indentation, wrapping, whitespace, quotes and stable printed layout. Formatting does not replace semantic naming rules.

Linting should enforce source correctness and convention where practical.

## 9. Reconstruction-specific requirements

### Preserve semantics, not original minification

WebR is not required to copy opaque/minified/generated class names from the original site.

For example, evidence such as:

```html
class="trae-icon trae-icon-ViewLeft_line"
```

may inform component/variant semantics, but authored WebR source should use WebR's own stable convention unless exact class preservation is required by observable behavior.

### Generated classes

Framework/build-tool generated class names are allowed when unavoidable, but authored source classes must follow this convention. Generated names must never be treated as the canonical design vocabulary.

### Evidence tracing

Where useful, use explicit `data-*` metadata for internal evidence/debug tracing rather than overloading CSS class names.

Example:

```html
<button class="wr-Button" data-wr-evidence="element-123">...</button>
```

Tracing attributes must not change user-visible behavior.

## 10. CSS architecture rules

- Prefer component-scoped authored rules over global selector chains.
- Avoid selectors that depend unnecessarily on deep DOM ancestry.
- Do not use IDs for reusable component styling.
- Keep state selectors explicit.
- Centralize reusable tokens.
- Preserve responsive behavior through explicit media/container rules derived from evidence.
- Avoid `!important` except for documented exceptional cases.

## 11. Accessibility

Reconstruction quality includes observable keyboard/focus/accessibility behavior when captured.

Authored components should preserve:

- focusability
- keyboard semantics
- relevant labels
- expanded/selected/disabled semantics
- focus-visible behavior

## 12. Rule precedence

When conventions conflict, use this precedence:

1. browser/platform correctness
2. frozen WebR behavior/evidence contracts
3. accessibility correctness
4. this source convention
5. formatter preferences

No naming convention may justify behavior that contradicts captured evidence.
