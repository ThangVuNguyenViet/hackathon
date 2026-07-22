# KFC Chat Response Mode Toggle

## Goal

Let a local customer switch subsequent KFC chatbot replies between text-only and Generative UI without resetting the conversation or introducing another agent path.

## User experience

- Show a compact two-option segmented control in the customer-chat header.
- Options are `Generative UI` and `Text only`.
- Default to `Generative UI` so current behavior remains unchanged.
- Switching mode affects the next customer message and later messages.
- Keep the same session and transcript when switching.
- Previously rendered widgets remain in the transcript; text-only mode only prevents new GenUI attachments.
- Disable mode changes while a message or confirmation is being processed so the visible selection always matches the request in flight.

## Data flow

The controller owns the selected response mode as customer-chat state. For each text submission it passes the existing request metadata field:

- `showcaseResponseMode: "genui"` for Generative UI.
- `showcaseResponseMode: "text"` for text-only responses.

The existing backend maps these values to its `genui` and `social` response profiles. No new endpoint, agent, model call, router, or persistence layer is added. GenUI actions continue through their existing action endpoint and remain available for widgets already present in the transcript.

## Components

- Add a small response-mode value type beside customer-chat state.
- Add a controller method that changes mode only while the chat is idle.
- Pass the selected mode through `CustomerChatRepository.startRun` metadata for text submissions.
- Render the segmented control in the existing customer-chat header.
- Add stable test keys for the control and each option.

## Error handling

Mode selection is local and cannot fail. Existing connection and backend errors keep their current behavior. A failed request does not change the selected mode.

## Verification

- Controller test: Generative UI is the default and sends `showcaseResponseMode: "genui"`.
- Controller test: selecting text sends `showcaseResponseMode: "text"` on the next message.
- Widget test: both options render, switching updates the selected state, and switching is disabled while processing.
- Repository request test: metadata is serialized unchanged.
- Run focused Flutter tests, the complete Flutter suite, and `flutter analyze`.
- Launch the customer entrypoint against the local backend and verify both modes manually in one session.
