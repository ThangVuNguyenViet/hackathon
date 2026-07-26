# Draft 2020-12 cross-value constraints

## Scope

This note evaluates two constraints in
`contracts/recommendations/v1/kfc-recommendation.schema.json` against the
declared `https://json-schema.org/draft/2020-12/schema` dialect:

1. a pending recommendation's finite `placement` is a member of
   `attemptedPlacements`; and
2. every `renderedActions[*].actionId` is distinct, while the action ID values
   themselves remain arbitrary strings.

Only the Draft 2020-12 specification and Ajv's own documentation/source are
used below.

## Findings

### `$data` is an Ajv extension, not Draft 2020-12

Draft 2020-12 defines `enum` as a schema-time array; an instance is valid only
when equal to one of that array's elements. Therefore,
`"enum": {"$data": "/attemptedPlacements"}` is not valid against the
standard dialect's meta-schema: the `enum` value is an object, not an array.
`const` accepts any JSON value, but standard semantics would compare against
the literal object `{"$data": "..."}`; it does not dereference it.

Ajv explicitly documents `$data` as an option which resolves JSON Pointers in
validated data and supports both `enum` and `const`. Ajv 8.20.0's Draft 2020
constructor passes the `$data` option into its 2020-12 meta-schema loader, and
that loader calls `dataMetaSchema` for its validation vocabulary. Consequently
the pre-correction repository's `Ajv2020({ $data: true })` test setup made
those rules effective in that Ajv configuration. It did **not** make the
published document a portable, standards-only Draft 2020-12 schema: a generic
validator could reject the dynamic `enum`, and standard `const` behavior cannot
enforce the action-ID comparisons.

Sources: [Draft 2020-12 validation, sections 5 and 6.1.2--6.1.3](https://json-schema.org/draft/2020-12/json-schema-validation), [Ajv `$data` documentation](https://ajv.js.org/guide/combining-schemas.html#data-reference), [Ajv 8.20.0 `Ajv2020` source](https://github.com/ajv-validator/ajv/blob/v8.20.0/lib/2020.ts), and [Ajv 8.20.0's 2020-12 meta-schema loader](https://github.com/ajv-validator/ajv/blob/v8.20.0/lib/refs/json-schema-2020-12/index.ts).

### Finite placement membership has a portable, same-shape equivalent

`Placement` is a finite enum. Retain the object and arrays as they are, but
replace the dynamic `enum` with one standard `if`/`then` branch per placement.
For every known placement `P`, state: if `pendingRecommendation.placement` is
`P`, then `attemptedPlacements` `contains` the static `const` value `P`.
`contains` applies a subschema to all array elements; without `minContains`,
the standard default is one matching element. This is portable Draft 2020-12
and needs no shape change. The `if` must require the relevant properties so it
does not succeed merely because an optional property is absent.

Illustrative branch (repeat for each `Placement` member):

```json
{
  "if": {
    "required": ["pendingRecommendation"],
    "properties": {
      "pendingRecommendation": {
        "type": "object",
        "required": ["placement"],
        "properties": { "placement": { "const": "P" } }
      }
    }
  },
  "then": {
    "properties": {
      "attemptedPlacements": { "contains": { "const": "P" } }
    }
  }
}
```

Sources: [Draft 2020-12 core, `contains`](https://json-schema.org/draft/2020-12/json-schema-core#section-10.3.1.3), [Draft 2020-12 validation, `minContains` default](https://json-schema.org/draft/2020-12/json-schema-validation#section-6.4.5), and [Draft 2020-12 core, `if`/`then`/`else`](https://json-schema.org/draft/2020-12/json-schema-core#section-10.2.2).

### Arbitrary projected action-ID uniqueness has no portable equivalent

`uniqueItems: true` applies to complete array elements, not a property selected
from each object. Thus it permits two different action objects that share the
same `actionId`. A maximum length of four makes Ajv `$data` comparisons finite,
but Draft 2020-12 has no standard keyword that reads one instance location and
uses it as another location's `const`/`not` value. `prefixItems` only selects
positions; it does not add cross-instance-value references.

Therefore, for arbitrary action IDs, there is no portable Draft 2020-12
same-shape equivalent. The selected correction keeps JSON Schema structural,
documents the limitation with `$comment`, and retains exact cross-value
enforcement in Zod and Pydantic. A portable schema-only option exists only if
the ID domain becomes a finite, schema-time enum: for each allowed ID, use
`contains` plus `maxContains: 1`. Converting `renderedActions` into a string ID
array and using `uniqueItems` would also work, but changes the wire shape.

Sources: [Draft 2020-12 validation, `uniqueItems`](https://json-schema.org/draft/2020-12/json-schema-validation#section-6.4.3), [Draft 2020-12 validation, `maxContains`](https://json-schema.org/draft/2020-12/json-schema-validation#section-6.4.4), and [Draft 2020-12 core, `prefixItems`/`items`](https://json-schema.org/draft/2020-12/json-schema-core#section-10.3.1.1).
