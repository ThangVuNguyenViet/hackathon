# KFC recommendation Sanity schema

This schema-only workspace deploys the backend's
`recommendationPolicy` document contract to the exact Task 9 Sanity project.
It intentionally contains no second dashboard or custom CMS.

After `npx sanity login`, set the public resource bindings and validate/deploy:

```bash
export SANITY_PROJECT_ID='<created-project-id>'
export SANITY_DATASET='production'
npm ci
npm run schema:validate
npm run schema:deploy
```

Seed atomically with the authenticated CLI user, then verify the same published
snapshot through a public tokenless read:

```bash
npm run policies:seed
npm run policies:check
```

`policies:seed` obtains the current CLI user's token in memory through
`sanity exec --with-user-token`. No API token is printed or written to the
workspace.
