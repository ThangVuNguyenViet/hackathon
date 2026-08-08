# PVCFC Chatbot Web UI Redesign Plan

## Goal

Redesign `pvcfc_website.html` to mirror the layout, proportions, and UI design of the Flutter `CustomerChatScreen` / KFC Chatbot interface while adapting to the PVCFC agricultural brand theme (`#0A6B41` primary, `#005A36` dark green, `#DAA520` gold accent).

## Key Design Improvements

1. **Header Layout**:
   - Square brand badge (`42x42px`, `border-radius: 10px`, deep green `#0A6B41` background) with seedling icon.
   - Title: `PVCFC Agriculture Chat` (20px, bold 700).
   - Subtitle: `Tư vấn nông nghiệp với trợ lý PVCFC` (13px, muted).
   - Right-aligned speech bubble outline icon.
   - Right-aligned Mode Toggle container (`Generative UI` vs `Text only`) with crisp pill buttons.

2. **Quick Suggestion Pills**:
   - Positioned horizontally at top of transcript when starting a session:
     - `Tư vấn lúa Hè Thu`
     - `Tính lượng phân bón`
     - `Chẩn đoán thối rễ`
     - `Hẹn Kỹ sư thăm vườn`
   - Outline pill style (height 34px, white background `#FFFFFF`, border `#E5E7EB`, `border-radius: 8px`).

3. **Message Transcripts**:
   - Customer message: right-aligned, deep green `#0A6B41` background, white text, `border-radius: 12px`.
   - Assistant message: left-aligned, white `#FFFFFF` background, subtle border `#E5E7EB`, `border-radius: 12px`.

4. **Bottom Chat Input Bar**:
   - Clean light gray input box (`#F3F4F6`), subtle border (`#E5E7EB`), placeholder `Nhắn PVCFC...`.
   - Square icon send button (`44x44px`, deep green `#0A6B41` background, paper-plane icon).

## File Changes

- `pvcfc_website.html`: Update CSS, HTML layout, and JavaScript to apply the clean minimalist KFC-parity UI.

## Verification

1. Serve `pvcfc_website.html` via Fastify backend (`http://165.154.229.65/`).
2. Verify visual appearance using local browser (`xd://browser`).
3. Deploy updated `pvcfc_website.html` to remote SCloud ULightHost and smoke test.
