# Ticket 04: Deploy Safety

## Type

Implementation and operations task.

## Goal

Make production deploys traceable and harder to perform from an unknown or unverified code state.

## Scope

- Expose git commit, Worker version, build timestamp, queue binding, D1 binding, and environment name in `/ready?deep=1`.
- Add a predeploy script that fails when required tests have not been run or the deployment source cannot be identified.
- Add a postdeploy smoke proof that sends a synthetic webhook event and verifies it leaves `received`.
- Record the deployed Worker version in a durable deployment log.

## Acceptance Criteria

- `/ready?deep=1` shows which code and queue consumer version is live.
- A deploy from an unexpected branch or dirty source requires an explicit override.
- Postdeploy smoke proof fails if queue consumption is not happening.

## Dependencies

- [01-delivery-state-machine.md](./01-delivery-state-machine.md)
